import { expect, it, vi } from 'vitest';
import { runInvoice } from './chain';

it('P01 cannot turn a clean policy ALLOW into payment without an AP debit adapter', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('UNEXPECTED_NETWORK'));
  try {
    const run = await runInvoice('4401', { caseId: 'P01:no-debit-adapter', payment: 'unavailable' });
    expect(run.assessment).toMatchObject({ verdict: 'ALLOW', ruleIds: ['IN_BADGE'] });
    expect(run.actual).toBe('HOLD');
    expect(run.result).toMatchObject({ status: 'held', verdict: 'ESCALATE', ruleIds: ['INVALID_INPUT'] });
    expect(run.result.receiptId).toBeUndefined();
    expect(run.mockDebits).toBe(0);
    expect(run.destinations).toEqual([]);
    expect(run.runtime.activations.map(row => row.role)).toEqual(['intake', 'extractor', 'vendor', 'payables', 'auditor']);
    expect(run.trace.some(row => row.role === 'payables' && row.tool === 'request_payment')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});
