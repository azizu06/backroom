import { agentCards } from './agent-cards';
import type { OfficeSnapshot } from './state';

/** Read-only orientation from the same snapshot and status model as the agent cards. */
export function fullFloorSummary(snapshot: OfficeSnapshot, now: number) {
  const roster = agentCards(snapshot, now);
  const warnings = roster.filter(card => card.tag === 'NEEDS YOU')
    .map(card => ({ id: card.agentId, text: `${card.title}: ${card.line}` }));
  if (snapshot.connection === 'disconnected') {
    warnings.unshift({ id: 'connection', text: 'Connection lost. Last received state is shown; model control is disabled.' });
  }
  return {
    roster, warnings,
    counters: {
      inbox: snapshot.inboxCount,
      handoffs: snapshot.handoffs?.filter(row => row.status === 'offered' || row.status === 'accepted').length ?? 0,
      // Audit rows have no timestamps: this is the total in the subscribed snapshot.
      audit: snapshot.audit.length,
    },
  };
}
