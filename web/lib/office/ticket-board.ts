import { invoiceLabel, officeText, shortOfficeText } from './display';
import { agentCards } from './agent-cards';
import { HANDOFF_AGENTS, isHandoffAgent, needsHandoffHuman } from './handoffs';
import { ROLES } from './palette';
import type { OfficeSnapshot } from './state';

export type TicketColumnId = 'queued' | 'progress' | 'needs-you' | 'done';
export interface TicketCard {
  readonly id: string;
  /** Friendly case label; internal identifiers are retained only in id. */
  readonly caseDisplayId: string;
  readonly summary: string;
  readonly agent: string;
  readonly color: string;
  readonly tag: 'READY' | 'WORKING' | 'NEEDS YOU' | 'DONE' | 'REJECTED';
  readonly rejected: boolean;
}
export interface TicketColumn {
  readonly id: TicketColumnId;
  readonly name: string;
  readonly count: number;
  readonly cards: readonly TicketCard[];
  readonly more: number;
}
export interface TicketBoardModel {
  readonly columns: readonly TicketColumn[];
  readonly notice: string | null;
  readonly empty: boolean;
}
const COLUMNS = [
  ['queued', 'Queued'], ['progress', 'In progress'], ['needs-you', 'Needs you'], ['done', 'Done'],
] as const;
export const TICKET_COLUMN_LIMIT = 6;
const summary = (text: string) => shortOfficeText(text) || 'Review needed';
const referenceInvoice = (ref: string) => invoiceLabel(ref)
  ?? /^(?:invoice:|ar_invoice:)?(\d+)$/i.exec(ref)?.[1]?.replace(/^(.*)$/, 'INV-$1');
const referenceCase = (refs: readonly string[] = []) => refs.map(ref => ref.match(/\bjudge:[\w-]+/i)?.[0]).find(Boolean)
  ?? refs.find(ref => /^case:/i.test(ref));
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Pure projection; audit arrays are oldest-first. Case refs are optional on legacy snapshots. */
export function ticketBoard(snapshot: OfficeSnapshot, now = Date.now()): TicketBoardModel {
  type Row = { caseKey?: string; column: TicketColumnId; card: TicketCard; at: number; sequence: bigint };
  const rows: Row[] = [];
  const agents = new Map(snapshot.agents.map(agent => [agent.id, agent]));
  const cards = agentCards(snapshot, now);
  const receipts = new Map([...snapshot.audit, ...(snapshot.inboxReceipts ?? [])].map(row => [row.id, row]));
  // Receipts can bridge an opaque inbox case to its extracted invoice number.
  const caseInvoices = new Map<string, string>();
  for (const receipt of receipts.values()) {
    const key = referenceCase(receipt.refs);
    const invoice = receipt.refs?.map(referenceInvoice).find(Boolean) ?? invoiceLabel(receipt.summary);
    if (key && invoice) caseInvoices.set(key, invoice);
  }
  const representedReceipts = new Set<string>();
  const representedAgents = new Set<string>();
  const owner = (id: string, role: string) => {
    const agent = agents.get(id);
    const fallback = HANDOFF_AGENTS[isHandoffAgent(role) ? role : 'human'];
    return { agent: agent?.name ?? (isHandoffAgent(role) ? fallback.name : 'Team'),
      color: isHandoffAgent(role) ? fallback.color : ROLES.frame };
  };
  for (const handoff of snapshot.handoffs ?? []) {
    const terminal = handoff.status === 'completed' || handoff.status === 'rejected';
    const agentId = handoff.toRole === 'human' ? handoff.fromAgentId : handoff.toAgentId;
    const role = handoff.toRole === 'human' ? handoff.fromRole : handoff.toRole;
    const task = cards.find(card => card.agentId === agentId && card.title.endsWith(` · ${handoff.caseDisplayId}`));
    const waiting = !terminal && (handoff.toRole === 'human' || !!agents.get(agentId)?.escalationId
      || needsHandoffHuman(handoff) || task?.tag === 'NEEDS YOU'
      || (handoff.decisionRef && receipts.get(handoff.decisionRef)?.decision === 'ESCALATE'));
    const column: TicketColumnId = terminal ? 'done' : waiting ? 'needs-you' : handoff.status === 'accepted' ? 'progress' : 'queued';
    if (waiting) {
      representedAgents.add(agentId);
      if (handoff.decisionRef) representedReceipts.add(handoff.decisionRef);
    }
    const rejected = handoff.status === 'rejected';
    rows.push({ caseKey: invoiceLabel(handoff.caseDisplayId) ?? handoff.caseDisplayId, column, at: handoff.completedAt ?? handoff.acceptedAt ?? handoff.createdAt, sequence: BigInt(handoff.sequence), card: {
      id: `handoff:${handoff.handoffId}`, caseDisplayId: officeText(handoff.caseDisplayId) || 'Case review', summary: summary(task?.line ?? handoff.summary),
      ...owner(agentId, role), rejected,
      tag: rejected ? 'REJECTED' : terminal ? 'DONE' : waiting ? 'NEEDS YOU' : column === 'progress' ? 'WORKING' : 'READY',
    } });
  }
  const handoffAgentsWaiting = new Set(representedAgents);
  let receiptOrder = 0;
  for (const receipt of receipts.values()) {
    receiptOrder++;
    const invoice = receipt.refs?.map(referenceInvoice).find(Boolean) ?? invoiceLabel(receipt.summary);
    const rawCase = referenceCase(receipt.refs);
    const caseKey = (rawCase ? caseInvoices.get(rawCase) : undefined) ?? invoice ?? rawCase;
    const handoffRepresentsCase = (snapshot.handoffs ?? []).some(row => needsHandoffHuman(row)
      && (invoiceLabel(row.caseDisplayId) ?? row.caseDisplayId) === caseKey);
    if (receipt.decision !== 'ESCALATE' || representedReceipts.has(receipt.id)
      || (handoffAgentsWaiting.has(receipt.agentId) && (!caseKey || handoffRepresentsCase))) continue;
    representedAgents.add(receipt.agentId);
    rows.push({ caseKey, column: 'needs-you', at: 0, sequence: BigInt(receiptOrder), card: {
      id: `receipt:${receipt.id}`, caseDisplayId: invoice ?? (rawCase && caseInvoices.get(rawCase)) ?? 'Review needed', summary: receipt.ruleIds.includes('BANK_CHANGE_HOLD') || /bank.change/i.test(receipt.summary) ? 'Held for Dana · bank change' : summary(receipt.summary),
      ...owner(receipt.agentId, receipt.seatId), rejected: false, tag: 'NEEDS YOU',
    } });
  }
  for (const task of cards) {
    const agent = agents.get(task.agentId)!;
    if (representedAgents.has(agent.id)) continue;
    const related = (snapshot.handoffs ?? []).filter(row => row.toAgentId === agent.id || row.fromAgentId === agent.id);
    // The shared title identifies the case already painted from a handoff row.
    if (related.some(row => task.title.endsWith(` · ${row.caseDisplayId}`))) continue;
    // Legacy/preview snapshots expose desk tasks in state, without handoff rows.
    // READY's invitation is not itself a ticket; do not resurrect finished handoffs.
    const stateTask = task.tag === 'READY' && related.length === 0
      && !!agent.state.trim() && !/^(idle|ready|available|offline)\b/i.test(agent.state);
    if (task.tag === 'READY' && !stateTask) continue;
    const tag = stateTask ? 'WORKING' : task.tag;
    rows.push({ column: tag === 'NEEDS YOU' ? 'needs-you' : tag === 'DONE' ? 'done' : 'progress',
      at: agent.rowAt ?? 0, sequence: 0n, card: {
      id: `agent:${agent.id}`, caseDisplayId: invoiceLabel(task.line) ?? officeText(task.title),
      summary: summary(stateTask ? agent.state : task.line),
      ...owner(agent.id, agent.seatId === 'vendor_onboarding' ? 'vendor' : agent.seatId), rejected: false, tag,
    } });
  }
  const waits = new Map<string, Row>();
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]!;
    if (row.column !== 'needs-you') continue;
    const caseId = invoiceLabel(row.card.caseDisplayId + ' ' + row.card.summary);
    const key = row.caseKey ?? caseId ?? row.card.id;
    const previous = waits.get(key);
    if (previous) {
      if (/bank.change/i.test(row.card.summary)) previous.card = { ...previous.card, summary: 'Held for Dana · bank change' };
      rows.splice(i, 1);
      continue;
    }
    waits.set(key, row);
    const bankChange = /bank.change/i.test(row.card.summary);
    row.card = { ...row.card, summary: bankChange ? 'Held for Dana · bank change' : row.card.summary };
  }
  rows.sort((a, b) => b.at - a.at || (a.sequence > b.sequence ? -1 : a.sequence < b.sequence ? 1 : lexical(a.card.id, b.card.id)));
  const columns = COLUMNS.map(([id, name]): TicketColumn => {
    const cards = rows.filter(row => row.column === id).map(row => row.card);
    return { id, name, count: cards.length, cards: cards.slice(0, TICKET_COLUMN_LIMIT), more: Math.max(0, cards.length - TICKET_COLUMN_LIMIT) };
  });
  const notices: Partial<Record<OfficeSnapshot['connection'], string>> = {
    preview: 'Preview · sample tickets', replay: 'Replay · recorded tickets',
    disconnected: 'Disconnected · last known tickets', connecting: 'Connecting · waiting for tickets',
  };
  return { columns, empty: rows.length === 0, notice: notices[snapshot.connection] ?? null };
}

/** Contains only displayed data: position ticks and hidden-card edits do not redraw the canvas. */
export function ticketBoardKey(model: TicketBoardModel): string { return JSON.stringify(model); }
export function ticketBoardText(model: TicketBoardModel): string {
  return [model.notice, model.empty ? 'No tickets yet' : null, ...model.columns.flatMap(column => [
    `${column.name} · ${column.count}`,
    ...column.cards.map(card => `${card.caseDisplayId} · ${card.summary} · ${card.agent} · ${card.tag}`),
    ...(column.more ? [`+${column.more} more`] : []),
  ])].filter(Boolean).join('\n');
}
