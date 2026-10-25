import { afterEach, expect, it, vi } from 'vitest';
import { runFailoverPair } from './failover';

afterEach(() => vi.unstubAllGlobals());

it.each([['P01', '4401'], ['P03', '4471'], ['P06', '4482']])('%s keeps the same outcome when GX10 is cut and audits cloud_fallback', async (scenario, invoice) => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runFailoverPair(scenario, invoice, { caseId: `test:${scenario}` });
  expect(run.sameOutcome).toBe(true);
  expect(run.baselineRoutes).toEqual(['local']);
  expect(run.cutRoutes).toEqual(['cloud_fallback']);
  expect(run.cloudRequests).toBe(1);
  expect(run.cloudTextOnly).toBe(true);
  expect(run.fallbackAudited).toBe(true);
  expect(run.models).toEqual(['claude-sonnet-5-5']);
  expect(run.match).toBe(true);
});

it('gives each keyed step its own id, even when two steps replay one invoice', async () => {
  const [a, b] = await Promise.all([runFailoverPair('P03', '4471', { caseId: 'P12:P03:0' }), runFailoverPair('P03', '4471', { caseId: 'P12:P03:1', senderDomain: 'acme-supply.com' })]);
  expect([a.id, b.id]).toEqual(['P03:0', 'P03:1']);
});
