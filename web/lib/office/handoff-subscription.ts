import type { AgentHandoffPublic } from '@backroom/orchestrator/spacetime-client/types';
import { handoffFromRow, upsertHandoffs } from './handoffs';

/** Re-project the subscribed public cache, keyed by handoffId. Deletions disappear on refresh too. */
export function projectHandoffRows(rows: readonly AgentHandoffPublic[]) {
  return upsertHandoffs([], rows.flatMap(row => {
    const handoff = handoffFromRow(row);
    return handoff ? [handoff] : [];
  }));
}
