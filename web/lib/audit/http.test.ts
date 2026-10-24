import { describe, expect, it, vi } from 'vitest';
import { MemoryStateStore } from '@backroom/orchestrator';
import { createAuditHTTP } from './http';

const origin = 'http://localhost:3031';
const secret = 'private-test-operator-code';
const request = (path: string, body?: unknown, cookie?: string) => new Request(`${origin}/api/audit/${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function setup() {
  const store = new MemoryStateStore();
  await store.appendAudit({ ts: 1, actor: 'code', seat: 'payables', action: 'pay_invoice', decision: 'ESCALATE',
    inputs: { invoiceId: '4419', relatedInvoiceId: '4402', amountDelta: 37, rawEmail: 'DO NOT SEND TO MODEL',
      decision: { kind: 'ESCALATE', quote: { sentenceId: 'P08', text: 'Recorded policy sentence.' } } },
    ruleIds: ['DUPLICATE_INVOICE'], refs: ['4419', '4402'], route: 'code', policyVersion: 1, latencyMs: 0, costUsd: 0 });
  const network = vi.fn(() => { throw new Error('Unexpected network'); });
  const handle = createAuditHTTP({ store: () => store, secret: () => secret, origin: () => origin,
    whyOptions: { apiKey: '', fetch: network, stateStore: store } });
  const login = await handle('session', request('session', { code: secret }));
  const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  return { store, handle, cookie, network };
}

describe('private audit HTTP boundary', () => {
  it('authenticates without exposing a server secret and returns a verified snapshot', async () => {
    const { handle, cookie } = await setup();
    expect((await handle('entries', request('entries'))).status).toBe(401);
    const response = await handle('entries', request('entries', undefined, cookie));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ chain: { valid: true, length: 1 }, entries: [{ id: 'audit:1', decision: 'ESCALATE' }] });
    expect(JSON.stringify(await (await handle('entries', request('entries', undefined, cookie))).json())).not.toContain(secret);
    const wrongCode = await handle('session', request('session', { code: 'wrong' }));
    expect(wrongCode.status).toBe(403);
    expect(await wrongCode.json()).toEqual({ error: 'Operator code rejected.' });
    const crossOrigin = request('session', { code: secret });
    crossOrigin.headers.set('origin', 'https://attacker.example');
    const foreign = await handle('session', crossOrigin);
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toEqual({ error: 'Origin rejected.' });
    expect((await handle('entries', request('entries', undefined, `${cookie}forged`))).status).toBe(401);
  });

  it('expires read sessions and fails closed when access is unconfigured', async () => {
    const store = new MemoryStateStore();
    let clock = 1000;
    const handle = createAuditHTTP({ store: () => store, secret: () => secret, origin: () => origin, now: () => clock });
    const login = await handle('session', request('session', { code: secret }));
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    expect(login.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(login.headers.get('set-cookie')).not.toContain('Secure');
    clock += 8 * 60 * 60 * 1000;
    expect((await handle('entries', request('entries', undefined, cookie))).status).toBe(401);
    const unavailable = createAuditHTTP({ store: () => store, secret: () => undefined, origin: () => origin });
    expect((await unavailable('entries', request('entries', undefined, cookie))).status).toBe(503);
  });
});

describe('audit session origins', () => {
  const PUBLIC = 'https://demo.example';
  const LOOPBACK = 'http://127.0.0.1:3477';
  const post = (handle: Awaited<ReturnType<typeof setup>>['handle'], code: string, originHeader: string) => handle('session', new Request(`${PUBLIC}/api/audit/session`, {
    method: 'POST', headers: { origin: originHeader, 'content-type': 'application/json' }, body: JSON.stringify({ code }),
  }));

  it('authorizes the declared loopback office with the operator code and an http cookie', async () => {
    const store = new MemoryStateStore();
    const handle = createAuditHTTP({ store: () => store, secret: () => secret, origin: () => PUBLIC, loopbackOrigin: () => LOOPBACK });
    const login = await post(handle, secret, LOOPBACK);
    expect(login.status).toBe(200);
    expect(await login.json()).toEqual({ authorized: true });
    const setCookie = login.headers.get('set-cookie')!;
    expect(setCookie).toContain('HttpOnly; SameSite=Strict');
    expect(setCookie).not.toContain('Secure');
    const cookie = setCookie.split(';')[0]!;
    expect((await handle('entries', new Request(`${LOOPBACK}/api/audit/entries`, { headers: { cookie } }))).status).toBe(200);
    const wrong = await post(handle, 'wrong', LOOPBACK);
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toEqual({ error: 'Operator code rejected.' });
  });

  it('rejects every other origin and still secures the public https session', async () => {
    const store = new MemoryStateStore();
    const handle = createAuditHTTP({ store: () => store, secret: () => secret, origin: () => PUBLIC, loopbackOrigin: () => LOOPBACK });
    for (const originHeader of ['https://attacker.example', 'http://localhost:3477', 'http://127.0.0.1:3478', 'https://127.0.0.1:3477', 'http://127.0.0.2:3477']) {
      const rejected = await post(handle, secret, originHeader);
      expect(rejected.status).toBe(403);
      expect(await rejected.json()).toEqual({ error: 'Origin rejected.' });
    }
    const login = await post(handle, secret, PUBLIC);
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('Secure');
    const unset = createAuditHTTP({ store: () => store, secret: () => secret, origin: () => PUBLIC });
    expect((await post(unset, secret, LOOPBACK)).status).toBe(403);
  });
});

describe('verified ask-why evidence', () => {
  it('uses server records, cites an entry, and declines unknown outcomes without network', async () => {
    const { handle, store, cookie, network } = await setup();
    await store.appendAudit({ ts: 2, actor: 'code', seat: 'payables', action: 'unclassified',
      inputs: { invoiceId: '9999' }, ruleIds: [], refs: [], route: 'code', policyVersion: 1, latencyMs: 0, costUsd: 0 });
    const response = await handle('why', request('why', { question: 'Why was invoice 4419 held?', entries: [{ id: 'forged' }] }, cookie));
    expect(await response.json()).toMatchObject({ source: 'fallback', citations: ['audit:1'], answer: expect.stringContaining('#4402') });
    expect(await (await handle('why', request('why', { question: 'Why invoice 9999?' }, cookie))).json()).toMatchObject({ source: 'ungrounded', citations: [] });
    expect((await handle('why', request('why', { question: '' }, cookie))).status).toBe(400);
    expect(network).not.toHaveBeenCalled();
  });

  it('reports the first tampered sequence and refuses to explain it', async () => {
    const { handle, store, cookie, network } = await setup();
    const entries = await store.listAudit();
    entries[0]!.inputs!.amountDelta = 999;
    vi.spyOn(store, 'listAudit').mockResolvedValue(entries);
    expect(await (await handle('entries', request('entries', undefined, cookie))).json()).toMatchObject({ chain: { valid: false, firstBrokenSeq: 1, reason: 'HASH_MISMATCH' } });
    expect((await handle('why', request('why', { question: 'Why invoice 4419?' }, cookie))).status).toBe(409);
    expect(network).not.toHaveBeenCalled();
  });

  it('sends only allowlisted typed evidence to the shared model router', async () => {
    const { store, cookie } = await setup();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: {
      content: JSON.stringify({ output: { answer: 'Escalated [entry:audit:1].', citations: ['audit:1'] }, confidence: 1 }),
    } }], usage: { cost: 0 } })));
    const handle = createAuditHTTP({ store: () => store, secret: () => secret, origin: () => origin,
      whyOptions: { apiKey: 'mock-key', fetch: fetcher, stateStore: store } });
    expect(await (await handle('why', request('why', { question: 'Why invoice 4419?' }, cookie))).json()).toMatchObject({ source: 'model', citations: ['audit:1'] });
    const sent = String(fetcher.mock.calls[0]![1]!.body);
    expect(sent).toContain('4402');
    expect(sent).not.toContain('DO NOT SEND TO MODEL');
    expect(sent).not.toContain('Recorded policy sentence.');
  });
});
