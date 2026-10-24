import { afterEach, expect, it, vi } from 'vitest';
import { runCallButton } from './call-button';

afterEach(() => vi.unstubAllGlobals());

it('refuses a blocked pre-call, rejects a phone number, and dials a ready gate once with no network', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runCallButton();
  expect(run.checks).toEqual({ blocked: true, invalid: true, ready: true });
  expect(run.blocked).toMatchObject({ error: 'PRECALL_BLOCKED', dialCalls: 0, providerRequests: 0,
    audit: { outcome: 'refused', code: 'PRECALL_BLOCKED', detail: 'Credit/OFAC check unavailable' } });
  expect(run.invalid).toMatchObject({ error: 'INVALID_REQUEST', dialCalls: 0, providerRequests: 0 });
  expect(run.ready).toMatchObject({ ok: true, dialCalls: 1, providerRequests: 1, audit: { outcome: 'accepted', code: 'DIAL_ACCEPTED' } });
  expect(run.networkCalls).toBe(0);
});
