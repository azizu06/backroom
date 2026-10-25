import { compareHandoffs, needsHandoffHuman } from './handoffs';
import type { PaletteName, RoleName } from './palette';
import { anchorLabel, type OfficeSnapshot } from './state';

export const AGENT_DONE_MS = 20_000;
export type AgentCardTag = 'NEEDS YOU' | 'WORKING' | 'READY' | 'DONE';
export interface AgentCard {
  readonly agentId: string;
  readonly title: string;
  readonly line: string;
  readonly tag: AgentCardTag;
  readonly colourRole: RoleName;
  readonly agentColour: PaletteName;
}

const STATUS_ROLE: Record<AgentCardTag, RoleName> = {
  'NEEDS YOU': 'statusWarn', WORKING: 'screenGlow', READY: 'statusOk', DONE: 'statusOk',
};
const AGENT_COLOUR: Record<string, PaletteName> = {
  intake: 'aqua', extractor: 'mint', vendor: 'lavender', vendor_onboarding: 'lavender',
  payables: 'butter', collections: 'mint', reconciler: 'aqua', auditor: 'blush',
};

/** View-only status; incoming accepted/completed handoffs describe the recipient's work. */
export function agentCards(snapshot: OfficeSnapshot, now: number): AgentCard[] {
  const handoffs = [...snapshot.handoffs ?? []].sort(compareHandoffs);
  return snapshot.agents.map(agent => {
    const related = handoffs.filter(row => row.toAgentId === agent.id || row.fromAgentId === agent.id);
    const active = related.findLast(row => row.toAgentId === agent.id && row.status === 'accepted');
    const latest = related.at(-1);
    const completed = related.findLast(row => row.toAgentId === agent.id && row.status === 'completed');
    const done = completed?.completedAt !== undefined && completed === latest
      && now >= completed.completedAt && now < completed.completedAt + AGENT_DONE_MS;
    const audit = snapshot.audit.findLast(row => row.agentId === agent.id);
    // Receipts are a subset of the ordered audit stream. Its later decisions resolve
    // an inbox escalation too; receipt-only snapshots fall back to receipt order.
    const receipt = snapshot.inboxReceipts?.findLast(row => row.agentId === agent.id);
    const pendingHandoff = related.some(row => row.toAgentId === agent.id
      && row.status !== 'completed' && row.status !== 'rejected' && needsHandoffHuman(row));
    const needsYou = !!agent.escalationId || (audit ?? receipt)?.decision === 'ESCALATE' || pendingHandoff;
    const tag: AgentCardTag = needsYou ? 'NEEDS YOU' : active ? 'WORKING' : done ? 'DONE' : 'READY';
    const ticket = active ?? (tag === 'DONE' || tag === 'NEEDS YOU' ? latest : undefined);
    const role = latest ? (latest.toAgentId === agent.id ? latest.toRole : latest.fromRole) : agent.seatId;
    const roleLabel = latest ? role.charAt(0).toUpperCase() + role.slice(1) : anchorLabel(agent.seatId);
    return {
      agentId: agent.id,
      title: `${agent.name} · ${roleLabel}${ticket?.caseDisplayId ? ` · ${ticket.caseDisplayId}` : ''}`,
      line: ticket?.summary || (needsYou ? receipt?.summary || audit?.summary || agent.state : '') || 'Ask me about issues/PRs',
      tag, colourRole: STATUS_ROLE[tag], agentColour: AGENT_COLOUR[role] ?? 'aqua',
    };
  });
}

/** Only painted content participates; row heartbeats and time within the Done window do not. */
export function agentCardKey(card: AgentCard): string {
  return JSON.stringify([card.title, card.line, card.tag, card.colourRole, card.agentColour]);
}
