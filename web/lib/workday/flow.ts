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
/** Short code-owned phrases; payload text and internal identifiers stay on the audit wall. */
export function flowCaption(row: Handoff) {
  const from = ROLE_WORK[row.fromRole], to = ROLE_WORK[row.toRole];
  const work: Record<HandoffAgentId, string> = {
    intake: 'sorting the documents', extractor: 'checking the fields', vendor: 'verifying vendor bank details',
    payables: 'checking payment policy', auditor: 'checking the audit record', collections: 'reviewing the call outcome',
    reconciler: 'matching the payment', human: 'held for Dana’s review',
  };
  const phrase = row.status === 'rejected' ? 'held for review'
    : row.correction ? 'checking a correction'
    : row.status === 'completed' ? 'finished the handoff' : work[row.toRole];
  return `${from.name} → ${to.name} · ${flowCase(row)} · ${phrase}`;
}
