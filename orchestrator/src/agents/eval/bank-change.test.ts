import { afterEach, expect, it, vi } from 'vitest';
import { runBankChange } from './bank-change';

afterEach(() => vi.unstubAllGlobals());

it('drives P04 through the dispatcher, then applies only a verified software passkey before paying the new master', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runBankChange();
  expect(run.before.runtime.status).toBe('held');
  expect(run.before.runtime.activations.map(row => row.role)).toEqual(['intake', 'extractor', 'vendor']);
  expect(run.before.vendorDecision?.ruleIds).toEqual(['BANK_CHANGE_HOLD']);
  expect(run.before.mockDebits).toBe(0);
  expect(run.beforeApproval.accountId).toBe('bank-master:cedar');
  expect(run.beforeApproval.applyStatus).toBe('awaiting_controller');
  expect(run.spokenRejected).toBe(true);
  expect(run.approval).toMatchObject({ status: 'approved', method: 'passkey' });
  expect(run.appliedStatus).toBe('approved');
  expect(run.master.accountId).toBe('SYNTHETIC-CEDAR-8822');
  expect(run.master.revision).toBe(run.beforeApproval.revision + 1);
  expect(run.after.runtime.status).toBe('done');
  expect(run.after.runtime.activations.map(row => row.role)).toEqual(['intake', 'extractor', 'vendor', 'payables', 'auditor']);
  expect(run.after.mockDebits).toBe(1);
  expect(run.destinations).toEqual([run.master.accountId]);
  expect(run.outcome).toBe('BANK_CHANGE_APPLIED');
});

it.each(['missing', 'deny', 'voice'] as const)('does not apply or pay P04 when approval is %s', async approval => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runBankChange({ approval });
  expect(run.master.accountId).toBe('bank-master:cedar');
  expect(run.master.revision).toBe(run.beforeApproval.revision);
  expect(run.appliedStatus).not.toBe('approved');
  expect(run.after.actual).toBe('HOLD');
  expect(run.destinations).toEqual([]);
  expect(run.spokenRejected).toBe(approval !== 'missing');
  expect(run.approval?.status).toBe(approval === 'deny' ? 'denied' : 'pending');
  expect(run.outcome).not.toBe('BANK_CHANGE_APPLIED');
});
