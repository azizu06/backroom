import { afterEach, expect, it, vi } from 'vitest';
import { runRecovery } from './recovery';

afterEach(() => vi.unstubAllGlobals());

it.each([false, true])('recovers P11 with one mock debit and fences the abandoned query (late cancellation=%s)', async lateCancel => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runRecovery({ lateCancel });
  expect(run.outcome).toBe('RECOVERED_ONE_MOCK_DEBIT');
  expect(run.replacement.status).toBe('done');
  expect(run.replacement.roles).toEqual(['payables', 'auditor']);
  expect(run.original.status).toBe('failed');
  expect(run.sameCase).toBe(true);
  expect(run.replacementToken).toBeGreaterThan(run.abandonedToken);
  expect(run.providerRequests).toEqual(['ap:papertrail:4401']);
  expect(run.mockDebits).toBe(1);
  expect(run.invoiceStatus).toBe('paid');
  expect(run.caseStatus).toBe('done');
  expect(run.activeActivations).toBe(0);
  expect(run.recoveryAudits).toBe(1);
  expect(run.rejectedWrites).toBeGreaterThan(0);
  expect(run.auditValid).toBe(true);
});
