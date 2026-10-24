import { afterEach, expect, it, vi } from 'vitest';
import { runCallButton } from './call-button';

afterEach(() => vi.unstubAllGlobals());

it('refuses a blocked pre-call, rejects a phone number, and dials a ready gate once with no network', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runCallButton();
  expect(run.checks).toEqual({ blocked: true, invalid: true, ready: true, cooldown: true, foreign: true, loopback: true });
  expect(run.blocked).toMatchObject({ status: 409, error: 'PRECALL_BLOCKED', providerAttempts: 0,
    admin: { status: 409, body: 'PRECALL_BLOCKED:Credit/OFAC check unavailable' },
    audit: { outcome: 'refused', code: 'PRECALL_BLOCKED', detail: 'Credit/OFAC check unavailable' },
    adminAudit: { action: 'CALL_BLOCKED_PRECALL', reason: 'Credit/OFAC check unavailable' } });
  expect(run.invalid).toMatchObject({ status: 400, error: 'INVALID_REQUEST', providerAttempts: 0, relayCalls: 0 });
  expect(run.ready).toMatchObject({ status: 200, ok: true, providerAttempts: 1, audit: { outcome: 'accepted', code: 'DIAL_ACCEPTED' } });
  expect(run.networkCalls).toBe(0);
});
