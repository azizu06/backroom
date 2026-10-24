import { describe, expect, it } from 'vitest';
import { matchingDenial } from './state';
import { createMockOfficeState } from './preview';

describe('office audit-linked room denial', () => {
  it('does not show a denied door without the exact DENY receipt', () => {
    const mock = createMockOfficeState();
    mock.denyTreasury();
    const snapshot = mock.source.getSnapshot();
    expect(matchingDenial(snapshot, 'treasury')?.auditId).toBe('preview-denial-0');
    expect(matchingDenial({ ...snapshot, audit: [] }, 'treasury')).toBeUndefined();
    for (const changed of [{ decision: 'ALLOW' as const }, { room: 'payables' as const }, { agentId: 'other' }, { action: 'pay_invoice' }]) {
      expect(matchingDenial({ ...snapshot, audit: [{ ...snapshot.audit[0]!, ...changed }] }, 'treasury')).toBeUndefined();
    }
    expect(matchingDenial(snapshot, 'payables')).toBeUndefined();
  });
});
