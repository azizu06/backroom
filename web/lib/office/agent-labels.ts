import type { OfficeAgent, OfficeSnapshot } from './state';

const NAMES = { collections: 'Alex', payables: 'Sam', vendor_onboarding: 'Jules' } as const;
/** Human-facing names are role-based; runtime identifiers stay intact for interactions and receipts. */
export function agentName(seat: string): string {
  return NAMES[seat as keyof typeof NAMES] ?? (seat === 'human' || seat === 'dana' ? 'Dana' : 'Agent');
}
export function agentState(state: string): string {
  const value = state.trim();
  if (/^(offline|disconnected|away)$/i.test(value)) return 'Away';
  if (!value || /^(idle|inactive)$/i.test(value)) return 'Idle';
  return /(?:demo:|\b(?:demo|synthetic|sandbox|preview)\b)/i.test(value) ? 'Idle' : value;
}
/** Older seed/runtime rows can describe the same seat. Keep its latest heartbeat, preferring an active row on ties. */
export function latestSeatAgents(agents: readonly OfficeAgent[]): OfficeAgent[] {
  const seats = new Map<string, OfficeAgent>();
  for (const agent of agents) {
    const previous = seats.get(agent.seatId);
    const at = agent.rowAt ?? 0, previousAt = previous?.rowAt ?? 0;
    if (!previous || at > previousAt || (at === previousAt && previous.state === 'Away' && agent.state !== 'Away')) seats.set(agent.seatId, agent);
  }
  return [...seats.values()];
}

/** Legacy named seats stay available in quiet/preview mode; working roles own the floor during a handoff. */
export function visibleSeatAgents(snapshot: OfficeSnapshot): readonly OfficeAgent[] {
  const workday = snapshot.handoffs?.some(row => row.status === 'offered' || row.status === 'accepted');
  return workday ? snapshot.agents.filter(agent => agent.escalationId || !/^(idle|ready|available|offline|away)$/i.test(agent.state.trim())) : snapshot.agents;
}
