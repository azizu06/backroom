import { describe, expect, it, vi } from 'vitest';
import { MemoryStateStore } from '@backroom/orchestrator';
import { createAuditHTTP } from '../audit/http';
import { createCallRequestHTTP } from '../calls/request';
import { createPolicyHTTP } from '../policy-editor/http';
import { createOperatorHTTP } from './http';
import { createOperatorSignIn, createSignInHTTP, hostOrigins, operatorSignedIn } from './sign-in';

const PUBLIC = 'https://demo.example', LOOPBACK = 'http://127.0.0.1:3397', CODE = 'private-operator-code';
const env = { DEMO_CONTROL_SECRET: 'private-host-key', DEMO_PORT: '3397', DEMO_PUBLIC_URL: PUBLIC, WEBAUTHN_ORIGIN: PUBLIC, CONTROLLER_ENROLLMENT_SECRET: CODE };

function host() {
  let clock = 1_000_000;
  const now = () => clock, store = new MemoryStateStore(), relay = vi.fn(async () => Response.json({}));
  const origins = () => hostOrigins(env);
  const signedIn = (request: Request) => operatorSignedIn(request, CODE, clock);
  const session = createSignInHTTP({ signIn: createOperatorSignIn({ code: () => CODE, origins, now }), signedIn, origins });
  // Each surface keeps its own origin rule and checks the one shared cookie itself.
  const operator = createOperatorHTTP({ env: () => env, store: () => store, run: async () => ({ ok: true }), now });
  const calls = createCallRequestHTTP({ secret: () => CODE, origin: () => PUBLIC, loopbackOrigin: () => LOOPBACK, now,
    relay: () => ({ url: 'http://127.0.0.1:8788/_admin/dial', secret: 'admin' }), currentCall: async () => null, audit: async () => undefined, fetch: relay as typeof fetch });
  const audit = createAuditHTTP({ store: () => store, secret: () => CODE, origin: () => PUBLIC, now });
  const policy = createPolicyHTTP({ store: () => store, pin: () => 'owner-pin-1234', origin: () => PUBLIC, now, signedIn });
  const post = (path: string, body: unknown, headers: Record<string, string>) => new Request(`${PUBLIC}${path}`, {
    method: 'POST', headers: { origin: PUBLIC, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const get = (path: string, headers: Record<string, string>) => new Request(`${PUBLIC}${path}`, { headers: { 'sec-fetch-site': 'same-origin', ...headers } });
  const surfaces = async (cookie: string, origin = PUBLIC) => [
    (await operator('status', post('/api/operator/status', {}, { cookie, origin, host: new URL(PUBLIC).host }))).status,
    (await calls(post('/api/calls/request', { line: 'collections' }, { cookie, origin }))).status,
    (await audit('entries', get('/api/audit/entries', { cookie }))).status,
    (await policy(get('/api/policy', { cookie }))).status,
  ];
  const signIn = (code: string, headers: Record<string, string> = {}) => session(post('/api/session', { code }, headers));
  return { session, surfaces, signIn, relay, store, policy, post, tick: (ms: number) => { clock += ms; } };
}
const cookieOf = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;

describe('one operator sign-in for the demo origin', () => {
  it('unlocks the operator console, desk phone, audit wall and policy editor with one cookie', async () => {
    const h = host();
    expect(await h.surfaces('')).toEqual([401, 401, 401, 401]);
    const response = await h.signIn(CODE);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/^backroom_session=\d+\.[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Strict; Secure; Max-Age=28800$/);
    expect(await h.surfaces(cookieOf(response))).toEqual([200, 200, 200, 200]);
    expect(h.relay).toHaveBeenCalledTimes(1);
    expect(await (await h.session(new Request(`${PUBLIC}/api/session`, { headers: { cookie: cookieOf(response) } }))).json()).toEqual({ signedIn: true });
  });
  it('records a session policy save as an operator-session save, not a PIN save', async () => {
    const h = host();
    const cookie = cookieOf(await h.signIn(CODE));
    const limits = { maxInstallments: 3, minFirstPct: 20, maxPlanDays: 60, maxPaymentCents: 500_000 };
    const saved = await h.policy(h.post('/api/policy', { expectedVersion: 1, limits }, { cookie }));
    expect(await saved.json()).toMatchObject({ authMethod: 'operator_session', policy: { policyVersion: 2 } });
    expect((await h.store.listAudit()).find(entry => entry.action === 'save_policy')?.inputs).toMatchObject({ method: 'operator_session' });
  });
  it('signs in from the host loopback office too, without Secure on plain http', async () => {
    const h = host();
    const response = await h.signIn(CODE, { origin: LOOPBACK });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).not.toContain('Secure');
  });
  it('rejects foreign origins, both at sign-in and on every surface', async () => {
    const h = host();
    for (const origin of ['https://evil.example', 'http://localhost:3397', `${PUBLIC}/`]) {
      expect((await h.signIn(CODE, { origin })).status).toBe(403);
    }
    expect((await h.signIn(CODE, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    const cookie = cookieOf(await h.signIn(CODE));
    const [operator, calls] = await h.surfaces(cookie, 'https://evil.example');
    expect([operator, calls]).toEqual([403, 403]);
    expect(h.relay).not.toHaveBeenCalled();
  });
  it('rejects an expired or forged session everywhere', async () => {
    const h = host();
    const cookie = cookieOf(await h.signIn(CODE));
    expect(await h.surfaces(`${cookie.slice(0, -1)}0`)).toEqual([401, 401, 401, 401]);
    h.tick(8 * 60 * 60 * 1000);
    expect(await h.surfaces(cookie)).toEqual([401, 401, 401, 401]);
    expect(h.relay).not.toHaveBeenCalled();
  });
  it('locks one client out for a minute after five wrong codes, correct code or not', async () => {
    const h = host(), client = { 'cf-connecting-ip': '203.0.113.7' };
    for (let i = 0; i < 5; i++) expect((await h.signIn('guess', client)).status).toBe(403);
    expect((await h.signIn(CODE, client)).status).toBe(429);
    expect((await h.signIn(CODE, { 'cf-connecting-ip': '198.51.100.2' })).status).toBe(200);
    h.tick(60_000);
    expect((await h.signIn(CODE, client)).status).toBe(200);
    for (let i = 0; i < 4; i++) await h.signIn('guess', client);
    expect((await h.signIn(CODE, client)).status).toBe(200);
    expect((await h.signIn('guess', client)).status).toBe(403);
  });
});
