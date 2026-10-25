import type { Handoff, HandoffAgentId } from '../office/handoffs';

export const ROLE_WORK: Record<HandoffAgentId, { name: string; job: string }> = {
  intake: { name: 'Intake', job: 'sort document' }, extractor: { name: 'Extractor', job: 'read fields' },
  vendor: { name: 'Vendor', job: 'verify domain/CRS' }, payables: { name: 'Payables', job: 'check policy; hold payment' },
  auditor: { name: 'Auditor', job: 'check audit record' }, collections: { name: 'Collections', job: 'review the call outcome' },
  reconciler: { name: 'Reconciler', job: 'match the bank record' }, human: { name: 'Dana', job: 'review with a passkey' },
};
/** Public display labels only; never arbitrary case strings or model free text. */
export function flowCase(row: Handoff) {
  const label = row.caseDisplayId.trim();
  return /^(?:INV|CASE)-\d{1,12}$/i.test(label) || /^••[\p{L}\p{N}]{1,16}$/u.test(label) ? label : 'this case';
}
/** Code-owned job descriptions plus an actual public edge/state; never repeat a model's free-text claims. */
export function flowCaption(row: Handoff) {
  const from = ROLE_WORK[row.fromRole], to = ROLE_WORK[row.toRole];
  const state = row.status === 'offered' ? 'offer pending' : row.status === 'accepted' ? 'accepted'
    : row.status === 'rejected' ? 'held for review' : 'turn completed';
  return `${from.name}: ${from.job} (${flowCase(row)}) → ${to.name}: ${to.job} · ${row.correction ? 'correction · ' : ''}${state}`;
}
