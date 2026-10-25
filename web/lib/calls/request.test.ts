import { describe, expect, it, vi } from 'vitest';
import { createCallRequestHTTP, type CallRequestAudit, type EmailOnlyScenario } from './request';
import { createOperatorSignIn, createSignInHTTP, operatorSessionCookie } from '../operator/sign-in';

const ORIGIN = 'https://demo.example';
const LOOPBACK = 'http://127.0.0.1:3477';
function harness(relayResponse: () => Promise<Response> = async () => Response.json({ sessionId: 's', callId: 'c' }), extras?: {
  loopback?: string; relay?: false;
  followUp?: (entry: CallRequestAudit) => Promise<{ status: 'queued' | 'duplicate' } | undefined>;
  emailOnlyRefusal?: (scenario: EmailOnlyScenario) => Promise<string[] | undefined>;
}) {
  let clock = 1_000_000;
  let current: { status: 'ringing' | 'live' | 'ended'; endedAt?: number } | null = null;
  const audits: CallRequestAudit[] = [];
  const relay = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => relayResponse());
  const handle = createCallRequestHTTP({ secret: () => 'operator-code', origin: () => ORIGIN, loopbackOrigin: () => extras?.loopback, now: () => clock,
    relay: extras?.relay === false ? () => undefined : () => ({ url: 'http://127.0.0.1:8788/_admin/dial', secret: 'admin-secret' }), currentCall: async () => current,
    audit: async entry => { audits.push(entry); }, followUp: extras?.followUp, emailOnlyRefusal: extras?.emailOnlyRefusal, fetch: relay as typeof fetch });
  // The desk phone has no code endpoint of its own: 'session' is the shared operator sign-in.
  const origins = () => [ORIGIN, ...(extras?.loopback ? [extras.loopback] : [])];
  const signIn = createSignInHTTP({ signIn: createOperatorSignIn({ code: () => 'operator-code', origins, now: () => clock }), signedIn: () => false, origins });
  const post = (action: 'session' | 'request', body: unknown, headers: Record<string, string> = {}) => {
    const request = new Request(`${ORIGIN}/api/${action === 'session' ? 'session' : 'calls/request'}`, {
      method: 'POST', headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return action === 'session' ? signIn(request) : handle(request);
  };
  const unlock = async () => {
    const response = await post('session', { code: 'operator-code' });
    return response.headers.get('set-cookie')!.split(';')[0]!;
  };
  return { handle, post, unlock, relay, audits, tick: (ms: number) => { clock += ms; }, setCurrent: (value: typeof current) => { current = value; } };
}
const click = (h: ReturnType<typeof harness>, cookie: string, body: unknown = { line: 'collections' }) => h.post('request', body, { cookie });

describe('office call request', () => {
  it('refuses without an operator session, from another origin, or with a forged cookie', async () => {
    const h = harness();
    const anonymous = await h.post('request', { line: 'collections' });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ ok: false, error: 'OPERATOR_SESSION_REQUIRED', message: expect.stringContaining('/operator') });
    const cookie = await h.unlock();
    expect((await h.post('request', {}, { cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect((await h.post('request', {}, { cookie, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await h.post('request', {}, { cookie: `${cookie.split('.')[0]}.forged` })).status).toBe(401);
    expect((await h.post('session', { code: 'guess' })).status).toBe(403);
    h.tick(8 * 60 * 60 * 1000 + 1);
    expect((await click(h, cookie)).status).toBe(401);
    expect(h.relay).not.toHaveBeenCalled();
    expect(h.audits.map(a => a.code)).toEqual(['OPERATOR_SESSION_REQUIRED', 'ORIGIN_REJECTED', 'OPERATOR_SESSION_REQUIRED']);
  });
  it('coalesces audit rows for repeated unauthenticated refusals', async () => {
    const h = harness();
    for (let i = 0; i < 3; i++) await h.post('request', {});
    h.tick(10_000);
    await h.post('request', {});
    expect(h.audits).toEqual([{ outcome: 'refused', code: 'OPERATOR_SESSION_REQUIRED' }, { outcome: 'refused', code: 'OPERATOR_SESSION_REQUIRED', suppressed: 2 }]);
  });
  it('dials the relay once with its server secret and never forwards a number from the request', async () => {
    const h = harness();
    const cookie = await h.unlock();
    expect(cookie).toMatch(/^backroom_session=\d+\.[a-f0-9]{64}$/);
    for (const body of [{ to: '+15555550199' }, { line: 'collections', number: '+15555550199' }, { line: 'payables' }, ['+15555550199']]) {
      expect((await click(h, cookie, body)).status).toBe(400);
    }
    expect(h.relay).not.toHaveBeenCalled();
    const response = await click(h, cookie);
    expect(await response.json()).toEqual({ ok: true, message: 'Ringing the allowlisted demo phone. Answer on speaker.' });
    expect(h.relay).toHaveBeenCalledTimes(1);
    const [url, init] = h.relay.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8788/_admin/dial');
    expect(init).toMatchObject({ method: 'POST', headers: { authorization: 'Bearer admin-secret' } });
    expect(init?.body).toBeUndefined();
    expect(h.audits.slice(-2)).toEqual([{ outcome: 'requested', code: 'DIAL_REQUESTED' }, { outcome: 'accepted', code: 'DIAL_ACCEPTED' }]);
  });
  it('places no call when the request cannot be audited first', async () => {
    const relay = vi.fn(async () => Response.json({}));
    const handle = createCallRequestHTTP({ secret: () => 'operator-code', origin: () => ORIGIN, relay: () => ({ url: 'http://127.0.0.1:8788/_admin/dial', secret: 'admin' }),
      currentCall: async () => null, audit: async () => { throw new Error('STATE_UNAVAILABLE'); }, fetch: relay as typeof fetch });
    const headers = { origin: ORIGIN, 'content-type': 'application/json' };
    const response = await handle(new Request(`${ORIGIN}/api/calls/request`, { method: 'POST',
      headers: { ...headers, cookie: operatorSessionCookie('operator-code', ORIGIN).split(';')[0]! }, body: '{}' }));
    expect(response.status).toBe(503);
    expect(relay).not.toHaveBeenCalled();
  });
  it('refuses a second click while a call is placed or on the line, then cools down', async () => {
    let release!: () => void;
    const h = harness(() => new Promise(resolve => { release = () => resolve(Response.json({})); }));
    const cookie = await h.unlock();
    const first = click(h, cookie);
    await vi.waitFor(() => expect(h.relay).toHaveBeenCalledTimes(1));
    expect(await (await click(h, cookie)).json()).toMatchObject({ error: 'CALL_REQUEST_IN_FLIGHT' });
    release(); expect((await first).status).toBe(200);
    h.setCurrent({ status: 'ringing' });
    expect(await (await click(h, cookie)).json()).toMatchObject({ error: 'CALL_ACTIVE' });
    h.setCurrent({ status: 'live' }); h.tick(60_000);
    expect((await click(h, cookie)).status).toBe(409);
    h.setCurrent({ status: 'ended', endedAt: 1_060_000 }); h.tick(5_000);
    expect(await (await click(h, cookie)).json()).toMatchObject({ error: 'COOLDOWN', message: 'Line cooling down. Try again in 15 s.' });
    h.tick(15_000);
    const next = click(h, cookie);
    await vi.waitFor(() => expect(h.relay).toHaveBeenCalledTimes(2));
    release(); expect((await next).status).toBe(200);
    expect(h.audits.filter(a => a.outcome === 'refused').map(a => a.code)).toEqual(['CALL_REQUEST_IN_FLIGHT', 'CALL_ACTIVE', 'CALL_ACTIVE', 'COOLDOWN']);
  });
  it('forwards one of two concurrent clicks while the call state read is pending', async () => {
    const h = harness();
    const cookie = await h.unlock();
    const results = await Promise.all([click(h, cookie), click(h, cookie)]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect(h.relay).toHaveBeenCalledTimes(1);
  });
  it('accepts the host loopback office after unlock and still dials only the server allowlist', async () => {
    const h = harness(async () => Response.json({ sessionId: 's', callId: 'c' }), { loopback: LOOPBACK });
    const locked = await h.post('request', { line: 'collections' }, { origin: LOOPBACK });
    expect(locked.status).toBe(401);
    expect(await locked.json()).toMatchObject({ error: 'OPERATOR_SESSION_REQUIRED' });
    const session = await h.post('session', { code: 'operator-code' }, { origin: LOOPBACK });
    expect(session.status).toBe(200);
    const setCookie = session.headers.get('set-cookie')!;
    expect(setCookie).not.toContain('Secure');
    const cookie = setCookie.split(';')[0]!;
    expect((await h.post('request', { to: '+15555550199' }, { cookie, origin: LOOPBACK })).status).toBe(400);
    expect(h.relay).not.toHaveBeenCalled();
    const response = await h.post('request', { line: 'collections' }, { cookie, origin: LOOPBACK });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, message: 'Ringing the allowlisted demo phone. Answer on speaker.' });
    expect(h.relay).toHaveBeenCalledTimes(1);
    const [url, init] = h.relay.mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:8788/_admin/dial');
    expect(init?.body).toBeUndefined();
    expect((await h.post('request', { line: 'collections' }, { cookie, origin: LOOPBACK })).status).toBe(429);
    expect(h.relay).toHaveBeenCalledTimes(1);
    const tunnel = harness(async () => Response.json({}), { loopback: LOOPBACK });
    expect((await click(tunnel, await tunnel.unlock())).status).toBe(200);
  });
  it('forwards one loopback click while another is still placing the call', async () => {
    let release!: () => void;
    const h = harness(() => new Promise(resolve => { release = () => resolve(Response.json({})); }), { loopback: LOOPBACK });
    const cookie = (await h.post('session', { code: 'operator-code' }, { origin: LOOPBACK })).headers.get('set-cookie')!.split(';')[0]!;
    const first = h.post('request', { line: 'collections' }, { cookie, origin: LOOPBACK });
    await vi.waitFor(() => expect(h.relay).toHaveBeenCalledTimes(1));
    expect((await h.post('request', { line: 'collections' }, { cookie, origin: LOOPBACK })).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(h.relay).toHaveBeenCalledTimes(1);
  });
  it('refuses loopback without a relay as voice down, and refuses every other origin', async () => {
    const down = harness(async () => Response.json({}), { loopback: LOOPBACK, relay: false });
    const cookie = (await down.post('session', { code: 'operator-code' }, { origin: LOOPBACK })).headers.get('set-cookie')!.split(';')[0]!;
    const voice = await down.post('request', { line: 'collections' }, { cookie, origin: LOOPBACK });
    expect(voice.status).toBe(503);
    expect(await voice.json()).toMatchObject({ error: 'VOICE_NOT_RUNNING' });
    const h = harness(async () => Response.json({}), { loopback: LOOPBACK });
    const unlocked = (await h.post('session', { code: 'operator-code' }, { origin: LOOPBACK })).headers.get('set-cookie')!.split(';')[0]!;
    for (const origin of ['https://evil.example', 'http://localhost:3477', 'http://127.0.0.1:3478', 'http://127.0.0.1:34770',
      'https://127.0.0.1:3477', 'http://127.0.0.2:3477', 'http://0.0.0.0:3477', `${LOOPBACK}/`]) {
      expect((await h.post('request', { line: 'collections' }, { cookie: unlocked, origin })).status).toBe(403);
      expect((await h.post('session', { code: 'operator-code' }, { origin })).status).toBe(403);
    }
    expect((await h.post('request', { line: 'collections' }, { cookie: unlocked, origin: LOOPBACK, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await h.post('request', { line: 'collections' }, { cookie: unlocked, origin: ORIGIN, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(h.relay).not.toHaveBeenCalled();
    expect(down.relay).not.toHaveBeenCalled();
  });
  it('relays pre-call and policy refusals, and never retries an unconfirmed dial', async () => {
    const blocked = harness(async () => new Response('PRECALL_BLOCKED:Credit/OFAC check unavailable', { status: 409 }));
    const response = await click(blocked, await blocked.unlock());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'PRECALL_BLOCKED', message: 'Pre-call checks blocked this call: Credit/OFAC check unavailable. No call placed.' });
    expect(blocked.audits.at(-1)).toEqual({ outcome: 'refused', code: 'PRECALL_BLOCKED', detail: 'Credit/OFAC check unavailable' });
    const down = harness(async () => { throw new DOMException('timed out', 'TimeoutError'); });
    const cookie = await down.unlock();
    expect(await (await click(down, cookie)).json()).toMatchObject({ error: 'RELAY_UNCONFIRMED' });
    expect((await click(down, cookie)).status).toBe(429);
    expect(down.relay).toHaveBeenCalledTimes(1);
  });

  it('shows a simulated email preview when the demo host handles an email-only refusal', async () => {
    const followUp = vi.fn(async () => ({ status: 'queued' as const }));
    const blocked = harness(async () => new Response('CALL_DENIED:B2B_ONLY_CALLS', { status: 409 }), { followUp });
    const response = await click(blocked, await blocked.unlock());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: 'CALL_DENIED',
      message: 'Policy refused the call (B2B_ONLY_CALLS). No call placed. Email preview (simulated, not sent).', email: 'queued' });
    expect(followUp).toHaveBeenCalledWith({ outcome: 'refused', code: 'CALL_DENIED', detail: 'B2B_ONLY_CALLS' });
  });

  it('refuses a seeded email-only client before any dial and shows the same-day dedupe', async () => {
    let queued = false;
    const followUp = vi.fn(async () => ({ status: queued ? 'duplicate' as const : (queued = true, 'queued' as const) }));
    const emailOnlyRefusal = vi.fn(async (scenario: string) => scenario === 'consumer' ? ['B2B_ONLY_CALLS'] : ['DNC']);
    const h = harness(undefined, { followUp, emailOnlyRefusal, relay: false });
    const cookie = await h.unlock();
    const first = await click(h, cookie, { line: 'collections', scenario: 'consumer' });
    expect(first.status).toBe(409);
    expect(await first.json()).toEqual({ ok: false, error: 'CALL_DENIED', email: 'queued',
      message: 'Policy refused the call (B2B_ONLY_CALLS). No call placed. Email preview (simulated, not sent).' });
    // No cooldown or voice relay applies: nothing was dialed, and the outbox owns the daily cap.
    const second = await click(h, cookie, { scenario: 'opt_out' });
    expect(await second.json()).toEqual({ ok: false, error: 'CALL_DENIED', email: 'duplicate',
      message: 'Policy refused the call (DNC). No call placed. Email preview already queued today (simulated, not sent); no second email.' });
    expect(h.audits).toEqual([{ outcome: 'refused', code: 'CALL_DENIED', detail: 'B2B_ONLY_CALLS', scenario: 'consumer' },
      { outcome: 'refused', code: 'CALL_DENIED', detail: 'DNC', scenario: 'opt_out' }]);
    expect(followUp).toHaveBeenNthCalledWith(1, h.audits[0]);
    expect(h.relay).not.toHaveBeenCalled();
  });

  it('rejects an unknown email-only client and reports a host without the seeded clients', async () => {
    const h = harness();
    const cookie = await h.unlock();
    const unknown = await click(h, cookie, { scenario: '+12025550199' });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: 'INVALID_REQUEST' });
    const missing = await click(h, cookie, { scenario: 'consumer' });
    expect(missing.status).toBe(503);
    expect(await missing.json()).toMatchObject({ error: 'SCENARIO_UNAVAILABLE', message: expect.stringContaining('No call placed') });
    const allowed = harness(undefined, { emailOnlyRefusal: async () => undefined });
    expect(await (await click(allowed, await allowed.unlock(), { scenario: 'opt_out' })).json()).toMatchObject({ error: 'SCENARIO_UNAVAILABLE' });
    expect(h.relay).not.toHaveBeenCalled();
    expect(allowed.relay).not.toHaveBeenCalled();
  });
});
