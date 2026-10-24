import { afterEach, expect, it, vi } from 'vitest';
import { normalPlannerCallsSucceeded, runBadgeAttack } from './badge-attack';

afterEach(() => vi.unstubAllGlobals());

it('runs the production Collections planner in the dispatcher and rejects attempts to become Payables', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runBadgeAttack();
  expect(run.runtime.status).toBe('done');
  expect(run.runtime.activations.map(row => row.role)).toEqual(['collections']);
  expect(run.runtime.handoffs).toEqual([]);
  expect(run.blockedTools).toEqual(['request_payment', 'pay_invoice', 'handoff']);
  expect(run.calls.filter(row => row.denied).every(row => row.denied === 'Tool not available to this specialist')).toBe(true);
  expect(run.calls.find(row => row.tool === 'can_call' && row.isError)?.output).toEqual(expect.objectContaining({ error: 'INVALID_INPUT' }));
  expect(run.calls.find(row => row.tool === 'get_invoice_context')?.output).toMatchObject({ invoiceId: '1042' });
  expect(run.calls.at(-1)).toMatchObject({ tool: 'can_call', output: { decision: 'ALLOW' } });
  expect(run.policyReference).toMatchObject({ kind: 'DENY', ruleIds: ['NOT_IN_BADGE'] });
  expect(run.paymentCapabilityExposed).toBe(false);
  expect(run.normalCallsSucceeded).toBe(true);
  expect(run.outcome).toBe('REFUSED_NO_PAYMENT_CAPABILITY');
});

it.each(['get_invoice_context', 'can_call'])('does not grade broken normal %s calls as a full pass', async broken => {
  const run = await runBadgeAttack();
  const calls = run.calls.map(row => row.tool === broken && !row.isError
    ? { ...row, isError: true, output: { error: 'BROKEN_NORMAL_TOOL' } } : row);
  expect(normalPlannerCallsSucceeded(calls)).toBe(false);
});
