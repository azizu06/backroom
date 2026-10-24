import { describe, expect, it, vi } from 'vitest';
import { createCallRequestHTTP, type CallRequestAudit } from './request';

const ORIGIN = 'https://demo.example';
function harness(relayResponse: () => Promise<Response> = async () => Response.json({ sessionId: 's', callId: 'c' })) {
  let clock = 1_000_000;
  let current: { status: 'ringing' | 'live' | 'ended'; endedAt?: number } | null = null;
  const audits: CallRequestAudit[] = [];
  const relay = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => relayResponse());
  const handle = createCallRequestHTTP({ secret: () => 'operator-code', origin: () => ORIGIN, now: () => clock,
    relay: () => ({ url: 'http://127.0.0.1:8788/_admin/dial', secret: 'admin-secret' }), currentCall: async () => current,
    audit: async entry => { audits.push(entry); }, fetch: relay as typeof fetch });
  const post = (action: 'session' | 'request', body: unknown, headers: Record<string, string> = {}) => handle(action, new Request(`${ORIGIN}/api/calls/${action}`, {
    method: 'POST', headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
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
    expect(await anonymous.json()).toMatchObject({ ok: false, error: 'OPERATOR_SESSION_REQUIRED', message: expect.stringContaining('/calls') });
    const cookie = await h.unlock();
    expect((await h.post('request', {}, { cookie, origin: 'https://evil.example' })).status).toBe(403);
    expect((await h.post('request', {}, { cookie, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await h.post('request', {}, { cookie: `${cookie.split('.')[0]}.forged` })).status).toBe(401);
    expect((await h.post('session', { code: 'guess' })).status).toBe(403);
    h.tick(12 * 60 * 60 * 1000 + 1);
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
    expect(cookie).toMatch(/^backroom_calls=\d+\.[a-f0-9]{64}$/);
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
    const session = await handle('session', new Request(`${ORIGIN}/api/calls/session`, { method: 'POST', headers, body: '{"code":"operator-code"}' }));
    const response = await handle('request', new Request(`${ORIGIN}/api/calls/request`, { method: 'POST',
      headers: { ...headers, cookie: session.headers.get('set-cookie')!.split(';')[0]! }, body: '{}' }));
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
});
