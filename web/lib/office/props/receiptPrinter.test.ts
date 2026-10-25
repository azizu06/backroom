import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, type OfficeAudit, type OfficeSnapshot } from '../state';
import { RECEIPT_PRINT_MS, hasNewAuditRow, receiptExtension } from './receiptPrinter';

const row = (id: string): OfficeAudit => ({ id, agentId: 'a', seatId: 'collections', action: 'read', decision: 'RECORDED', ruleIds: [], summary: id });
const snapshot = (count: number, connection: OfficeSnapshot['connection'] = 'preview'): OfficeSnapshot =>
  ({ ...INITIAL_OFFICE, connection, audit: Array.from({ length: count }, (_, i) => row(String(i))) });

describe('hasNewAuditRow', () => {
  it('prints once for a growing audit, including a batch of rows', () => {
    expect(hasNewAuditRow(snapshot(0), snapshot(1))).toBe(true);
    expect(hasNewAuditRow(snapshot(1, 'live'), snapshot(4, 'live'))).toBe(true);
    expect(hasNewAuditRow(snapshot(4), snapshot(4))).toBe(false);
  });

  it('ignores initial history, replacements and resets', () => {
    expect(hasNewAuditRow(null, snapshot(8))).toBe(false);
    expect(hasNewAuditRow(snapshot(2), { ...snapshot(2), audit: [row('new-a'), row('new-b')] })).toBe(false);
    expect(hasNewAuditRow(snapshot(4), snapshot(0))).toBe(false);
    expect(hasNewAuditRow(snapshot(0), snapshot(1))).toBe(true);
  });

  it('does not animate replay or the transition out of replay', () => {
    expect(hasNewAuditRow(snapshot(1), snapshot(2, 'replay'))).toBe(false);
    expect(hasNewAuditRow(snapshot(1, 'replay'), snapshot(2, 'replay'))).toBe(false);
    expect(hasNewAuditRow(snapshot(1, 'replay'), snapshot(2, 'live'))).toBe(false);
  });
});

describe('receiptExtension', () => {
  it('extrudes and retracts over 1.2 seconds, then stays at rest', () => {
    expect(RECEIPT_PRINT_MS).toBe(1200);
    expect(receiptExtension(-10)).toBe(0.025);
    expect(receiptExtension(0)).toBe(0.025);
    expect(receiptExtension(300)).toBeGreaterThan(receiptExtension(0));
    expect(receiptExtension(600)).toBeCloseTo(0.265);
    expect(receiptExtension(900)).toBeCloseTo(receiptExtension(300));
    expect(receiptExtension(1200)).toBeCloseTo(0.025);
    expect(receiptExtension(5000)).toBeCloseTo(0.025);
  });
});
