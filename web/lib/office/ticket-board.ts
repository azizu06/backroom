import { HANDOFF_AGENTS, isHandoffAgent } from './handoffs';
import { ROLES } from './palette';
import type { OfficeSnapshot } from './state';

export type TicketColumnId = 'queued' | 'progress' | 'needs-you' | 'done';
export interface TicketCard {
  readonly id: string;
  /** Receipts/agent escalations have no case id in OfficeSnapshot: show their actual id instead. */
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
const summary = (text: string) => Array.from(text).slice(0, 40).join('');
const lexical = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Pure projection; audit arrays are oldest-first and carry no timestamps or case linkage. */
export function ticketBoard(snapshot: OfficeSnapshot): TicketBoardModel {
  type Row = { column: TicketColumnId; card: TicketCard; at: number; sequence: bigint };
  const rows: Row[] = [];
  const agents = new Map(snapshot.agents.map(agent => [agent.id, agent]));
  const receipts = new Map([...snapshot.audit, ...(snapshot.inboxReceipts ?? [])].map(row => [row.id, row]));
  const representedReceipts = new Set<string>();
  const representedAgents = new Set<string>();
  const owner = (id: string, role: string) => {
    const agent = agents.get(id);
    const fallback = HANDOFF_AGENTS[isHandoffAgent(role) ? role : 'human'];
    return { agent: agent?.name ?? (isHandoffAgent(role) ? fallback.name : id || 'Human'),
      color: isHandoffAgent(role) ? fallback.color : ROLES.frame };
  };
  for (const handoff of snapshot.handoffs ?? []) {
    const terminal = handoff.status === 'completed' || handoff.status === 'rejected';
    const agentId = handoff.toRole === 'human' ? handoff.fromAgentId : handoff.toAgentId;
    const role = handoff.toRole === 'human' ? handoff.fromRole : handoff.toRole;
    const waiting = !terminal && (handoff.toRole === 'human' || !!agents.get(agentId)?.escalationId
      || (handoff.decisionRef && receipts.get(handoff.decisionRef)?.decision === 'ESCALATE'));
    const column: TicketColumnId = terminal ? 'done' : waiting ? 'needs-you' : handoff.status === 'accepted' ? 'progress' : 'queued';
    if (waiting) {
      representedAgents.add(agentId);
      if (handoff.decisionRef) representedReceipts.add(handoff.decisionRef);
    }
    const rejected = handoff.status === 'rejected';
    rows.push({ column, at: handoff.completedAt ?? handoff.acceptedAt ?? handoff.createdAt, sequence: BigInt(handoff.sequence), card: {
      id: `handoff:${handoff.handoffId}`, caseDisplayId: handoff.caseDisplayId, summary: summary(handoff.summary),
      ...owner(agentId, role), rejected,
      tag: rejected ? 'REJECTED' : terminal ? 'DONE' : waiting ? 'NEEDS YOU' : column === 'progress' ? 'WORKING' : 'READY',
    } });
  }
  let receiptOrder = 0;
  for (const receipt of receipts.values()) {
    receiptOrder++;
    if (receipt.decision !== 'ESCALATE' || representedReceipts.has(receipt.id)) continue;
    representedAgents.add(receipt.agentId);
    rows.push({ column: 'needs-you', at: 0, sequence: BigInt(receiptOrder), card: {
      id: `receipt:${receipt.id}`, caseDisplayId: receipt.id, summary: summary(receipt.summary),
      ...owner(receipt.agentId, receipt.seatId), rejected: false, tag: 'NEEDS YOU',
    } });
  }
  for (const agent of snapshot.agents) {
    if (!agent.escalationId || representedAgents.has(agent.id)) continue;
    rows.push({ column: 'needs-you', at: agent.rowAt ?? 0, sequence: 0n, card: {
      id: `escalation:${agent.escalationId}`, caseDisplayId: agent.escalationId, summary: summary(agent.state),
      ...owner(agent.id, agent.seatId === 'vendor_onboarding' ? 'vendor' : agent.seatId), rejected: false, tag: 'NEEDS YOU',
    } });
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
