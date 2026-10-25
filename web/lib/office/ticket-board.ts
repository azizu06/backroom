import { agentCards } from './agent-cards';
import { HANDOFF_AGENTS, isHandoffAgent, needsHandoffHuman } from './handoffs';
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
export function ticketBoard(snapshot: OfficeSnapshot, now = Date.now()): TicketBoardModel {
  type Row = { column: TicketColumnId; card: TicketCard; at: number; sequence: bigint };
  const rows: Row[] = [];
  const agents = new Map(snapshot.agents.map(agent => [agent.id, agent]));
  const cards = agentCards(snapshot, now);
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
    rows.push({ column, at: handoff.completedAt ?? handoff.acceptedAt ?? handoff.createdAt, sequence: BigInt(handoff.sequence), card: {
      id: `handoff:${handoff.handoffId}`, caseDisplayId: handoff.caseDisplayId, summary: summary(task?.line ?? handoff.summary),
      ...owner(agentId, role), rejected,
      tag: rejected ? 'REJECTED' : terminal ? 'DONE' : waiting ? 'NEEDS YOU' : column === 'progress' ? 'WORKING' : 'READY',
    } });
  }
  const handoffAgentsWaiting = new Set(representedAgents);
  let receiptOrder = 0;
  for (const receipt of receipts.values()) {
    receiptOrder++;
    if (receipt.decision !== 'ESCALATE' || representedReceipts.has(receipt.id) || handoffAgentsWaiting.has(receipt.agentId)) continue;
    representedAgents.add(receipt.agentId);
    rows.push({ column: 'needs-you', at: 0, sequence: BigInt(receiptOrder), card: {
      id: `receipt:${receipt.id}`, caseDisplayId: receipt.id, summary: summary(receipt.summary),
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
      id: `agent:${agent.id}`, caseDisplayId: agent.escalationId ?? task.title,
      summary: summary(stateTask ? agent.state : task.line),
      ...owner(agent.id, agent.seatId === 'vendor_onboarding' ? 'vendor' : agent.seatId), rejected: false, tag,
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
