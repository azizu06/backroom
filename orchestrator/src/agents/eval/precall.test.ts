import { afterEach, expect, it, vi } from 'vitest';
import { PRECALL_STOPS, runPrecallStop } from './precall';

afterEach(() => vi.unstubAllGlobals());

it.each(PRECALL_STOPS)('%s: planner refuses with the key rule and a direct dial is rejected before any provider request', async id => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runPrecallStop(id);
  expect(run.checks).toEqual(Object.fromEntries(Object.keys(run.checks).map(key => [key, true])));
});

it('C15 identifies its OFAC stop as fixture context, before even the injected credit check is called', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runPrecallStop('C15');
  expect(run.sanctionsEvidence).toEqual({ fixtureOfacHit: true, creditCheckCalls: 0,
    liveCrsExecuted: false, mappedSanctionsIdentity: null });
  expect(run.permit).toEqual({ decision: 'ESCALATE', ruleIds: ['OFAC_STOP'] });
  expect(run.providerRequests).toBe(0);
  expect(run.email.status).toBe('blocked');
});
