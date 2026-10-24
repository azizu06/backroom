import { afterEach, expect, it, vi } from 'vitest';
import { northfieldInvoice } from '../../payables';
import { runInvoice } from './chain';

afterEach(() => vi.unstubAllGlobals());
it('runs the merged AP chain through the real runtime without outbound network', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const clean = await runInvoice('4401');
  expect(clean.runtime.status).toBe('done');
  expect(clean.runtime.activations.map(row => row.role)).toEqual(['intake', 'extractor', 'vendor', 'payables', 'auditor']);
  expect(clean.mockDebits).toBe(1);
  expect(clean.runtime.syntheticLedger.unknownSettlements).toBe(0);
  const fraud = await runInvoice('4471');
  expect(fraud.actual).toBe('HOLD');
  expect(fraud.vendor.ruleIds).toContain('LOOKALIKE_DOMAIN');
  expect(fraud.mockDebits).toBe(0);
  const bankChange = await runInvoice('4480');
  expect(bankChange.vendorDecision?.ruleIds).toEqual(['BANK_CHANGE_HOLD']);
  expect(bankChange.mockDebits).toBe(0);
  const historical = await runInvoice('3001');
  expect(historical.runtime.status).toBe('done');
  expect(historical.mockDebits).toBe(0);
});
it('does not turn schema-invalid mock extraction into a payment', async () => {
  const run = await runInvoice('4401', { candidate: { ...northfieldInvoice('4401'), amountCents: 1 } });
  expect(run.actual).toBe('ERROR');
  expect(run.mockDebits).toBe(0);
  expect(run.extraction).toBeUndefined();
});
