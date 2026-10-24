import type { OfficeSnapshot } from '../state';

export const RECEIPT_PRINT_MS = 1200;
type AuditSnapshot = Pick<OfficeSnapshot, 'audit' | 'connection'>;

/** Initial history, replacement rows and replay scrubbing are never new live receipts. */
export function hasNewAuditRow(previous: AuditSnapshot | null, snapshot: AuditSnapshot): boolean {
  return previous !== null && previous.connection !== 'replay' && snapshot.connection !== 'replay'
    && snapshot.audit.length > previous.audit.length;
}

/** Extrude, then retract; at rest only a small paper lip remains. */
export function receiptExtension(ageMs: number): number {
  const progress = Math.min(1, Math.max(0, ageMs / RECEIPT_PRINT_MS));
  return 0.025 + 0.24 * Math.sin(Math.PI * progress);
}
