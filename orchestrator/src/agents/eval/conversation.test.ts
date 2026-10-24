import { afterEach, expect, it, vi } from 'vitest';
import { CONVERSATIONS, runConversation } from './conversation';

afterEach(() => vi.unstubAllGlobals());

it.each(CONVERSATIONS)('%s: scripted call through the gateway, then the Dispatcher, matches the key outcome', async name => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runConversation(name);
  expect(run.checks).toEqual(Object.fromEntries(Object.keys(run.checks).map(key => [key, true])));
  expect(run.match).toBe(true);
});

it('without the host-declared pairing the Reconciler refuses under the Dispatcher (pre-fix behaviour)', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runConversation('already_paid_matched', { pairing: false });
  expect(run.roles).toEqual(['collections']);
  expect(run).toMatchObject({ caseStatus: 'held', reason: 'RECONCILIATION_CASE_MISMATCH' });
  expect(run.cleared).toBe(false);
  expect(run.match).toBe(false);
});
