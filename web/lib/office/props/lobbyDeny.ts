import type { OfficeSnapshot } from '../state';

/** The last DENY stays on the board even if later receipts allow other actions. */
export function latestDenyRule(snapshot: Pick<OfficeSnapshot, 'audit'>): string | null {
  const row = snapshot.audit.findLast(row => row.decision === 'DENY');
  return row ? row.ruleIds[0] ?? 'DENIED' : null;
}
