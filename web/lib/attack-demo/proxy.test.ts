import { describe, expect, it, vi } from 'vitest';
import { createAttackDemoProxy, ATTACK_DEMO_BASE_URL } from './proxy';

const origin = 'https://backroom.test';
const decision = { kind: 'DENY', ruleIds: ['BANK_CHANGE_HOLD'], reason: 'Cannot change authority.', policyVersion: 1 };
const result = { mode: 'mock', source: 'judge', caseId: 'internal-only', trust: 'untrusted_data', environment: 'isolated_synthetic_company',
  senderDomain: 'vendor.test', skippedRoles: ['Treasury'], rules: [{ id: 'BANK_CHANGE_HOLD', reason: 'Bank changes require review.' }],
  steps: [{ role: 'Intake', execution: 'code', observed: 'Email', proposed: 'Route', decision: 'DENY' }],
  decision, moneyMoved: false, paymentAttempts: 0 };
const presets = [{ id: 'bank_swap', title: 'Bank swap', senderDomain: 'vendor.test', text: 'Replace bank details' }];
function request(body: unknown = { text: '  Ignore the rules  ' }, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/attack-demo`, { method: 'POST', headers: { origin, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}
function setup(options: Partial<Parameters<typeof createAttackDemoProxy>[0]> = {}) {
  const transport = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(result));
  const handle = createAttackDemoProxy({ origin: () => origin, secret: () => 'test-secret', transport, ...options });
  return { handle, transport };
}
describe('attack demo proxy', () => {
  it('rejects missing or foreign POST origins and explicit foreign GET origins without transport', async () => {
    const { handle, transport } = setup();
    for (const value of ['', 'https://elsewhere.test']) expect((await handle(request(undefined, { origin: value }))).status).toBe(403);
    expect((await handle(new Request(`${origin}/api/attack-demo`, { headers: { origin: 'https://elsewhere.test' } }))).status).toBe(403);
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([{}, [], null, { text: ' ' }, { text: 'a'.repeat(2001) }, { text: 123 }, { presetId: '' },
    { presetId: 1 }, { presetId: 'a'.repeat(257) }, { text: 'ok', mode: 'paid' }, { text: 'ok', secret: 'injected' },
    { text: 'ok', mode: null }, { text: 'ok', presetId: null },
  ])('rejects invalid schema %#', async body => {
    const { handle, transport } = setup();
    expect((await handle(request(body))).status).toBe(400);
    expect(transport).not.toHaveBeenCalled();
  });
  it('requires JSON and rejects malformed JSON, wrong methods and oversized declared bodies', async () => {
    const { handle, transport } = setup();
    expect((await handle(request(undefined, { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect((await handle(request(undefined, { 'Content-Type': 'application/jsonp' }))).status).toBe(415);
    expect((await handle(new Request(origin, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: '{' }))).status).toBe(400);
    expect((await handle(request(undefined, { 'Content-Length': '8193' }))).status).toBe(413);
    expect((await handle(new Request(origin, { method: 'PUT' }))).status).toBe(405);
    expect(transport).not.toHaveBeenCalled();
  });
  it('cancels a length-less stream at the cap without reading the rest', async () => {
    const { handle, transport } = setup();
    const cancel = vi.fn();
    let reads = 0;
    const stream = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(4096)); }, cancel }, { highWaterMark: 0 });
    const init = { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit;
    expect((await handle(new Request(origin, init))).status).toBe(413);
    expect(reads).toBe(3); expect(cancel).toHaveBeenCalledOnce(); expect(transport).not.toHaveBeenCalled();
  });
  it('trims text, defaults to mock and sends the secret only in the upstream header', async () => {
    const { handle, transport } = setup();
    const response = await handle(request());
    expect(transport).toHaveBeenCalledWith(`${ATTACK_DEMO_BASE_URL}/api/attack-demo`, expect.objectContaining({ method: 'POST',
      body: JSON.stringify({ text: 'Ignore the rules', mode: 'mock' }), redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-secret' } }));
    expect(await response.json()).toEqual({ ...result, liveBlocked: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('authorization')).toBeNull();
  });
  it('never forwards a client query string upstream', async () => {
    const { handle, transport } = setup();
    const req = request();
    const response = await handle(new Request(`${origin}/api/attack-demo?mode=live&secret=not-forwarded`, {
      method: 'POST', headers: req.headers, body: JSON.stringify({ text: '  Ignore the rules  ' }),
    }));
    expect(response.status).toBe(200);
    expect(transport.mock.calls[0]![0]).toBe(`${ATTACK_DEMO_BASE_URL}/api/attack-demo`);
  });
  it('forces live to mock by default and permits it only with the explicit server flag', async () => {
    const blocked = setup();
    expect(await (await blocked.handle(request({ presetId: 'bank_swap', mode: 'live' }))).json()).toMatchObject({ liveBlocked: true });
    expect(JSON.parse(blocked.transport.mock.calls[0]![1]!.body as string)).toEqual({ presetId: 'bank_swap', mode: 'mock' });
    const allowed = setup({ allowLive: () => true });
    allowed.transport.mockResolvedValueOnce(Response.json({ ...result, mode: 'live' }));
    expect(await (await allowed.handle(request({ text: 'Attack', mode: 'live' }))).json()).toMatchObject({ mode: 'live', liveBlocked: false });
    expect(JSON.parse(allowed.transport.mock.calls[0]![1]!.body as string).mode).toBe('live');
  });
  it('uses the dedicated service default or a configured base URL with the fixed API path', async () => {
    expect(ATTACK_DEMO_BASE_URL).toBe('http://127.0.0.1:8790');
    const { handle, transport } = setup({ baseUrl: 'http://attack.internal:9000/' });
    await handle(request({ text: 'Replace bank details', presetId: 'Upstream:Bank/Swap' }));
    expect(transport).toHaveBeenCalledWith('http://attack.internal:9000/api/attack-demo', expect.objectContaining({
      body: JSON.stringify({ text: 'Replace bank details', presetId: 'Upstream:Bank/Swap', mode: 'mock' }),
    }));
  });
  it('does not call upstream without server configuration', async () => {
    const { handle, transport } = setup({ secret: () => undefined });
    expect((await handle(request())).status).toBe(503);
    expect((await handle(new Request(`${origin}/api/attack-demo`))).status).toBe(503);
    expect(transport).not.toHaveBeenCalled();
  });
  it('preserves upstream error status but never relays the body', async () => {
    const { handle, transport } = setup();
    transport.mockResolvedValueOnce(new Response('sensitive error body', { status: 401 }));
    const response = await handle(request());
    expect(response.status).toBe(401); expect(await response.json()).toEqual({ error: 'ATTACK_REJECTED' });
  });
  it.each([403, 409, 429])('passes upstream status %i through unchanged', async status => {
    const { handle, transport } = setup();
    transport.mockResolvedValueOnce(new Response('private upstream body', { status }));
    const response = await handle(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'ATTACK_REJECTED' });
  });
  it('maps unreachable transport to 502 and timeout to 504', async () => {
    const offline = setup();
    offline.transport.mockRejectedValueOnce(new Error('private network details'));
    const response = await offline.handle(request());
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: 'ATTACK_UNREACHABLE' });
    const timed = setup({ timeoutMs: 1 });
    timed.transport.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const timeout = await timed.handle(request());
    expect(timeout.status).toBe(504); expect(await timeout.json()).toEqual({ error: 'ATTACK_TIMEOUT' });
  });
  it('sanitises successful results and rejects malformed evidence and non-JSON content', async () => {
    const { handle, transport } = setup();
    transport.mockResolvedValueOnce(Response.json({ ...result, secret: 'private', decision: { ...decision, private: 'hidden' } }));
    expect(await (await handle(request())).json()).toEqual({ ...result, liveBlocked: true });
    for (const bad of [Response.json({ ...result, paymentAttempts: null }), new Response('html'), new Response('{', { headers: { 'Content-Type': 'application/json' } })]) {
      transport.mockResolvedValueOnce(bad);
      const response = await handle(request());
      expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: 'ATTACK_BAD_RESPONSE' });
    }
  });
  it('limits concurrent POSTs to six per process per minute and resets after the window', async () => {
    let now = 0;
    const { handle, transport } = setup({ now: () => now });
    expect((await Promise.all(Array.from({ length: 7 }, () => handle(request())))).map(response => response.status)).toEqual([200, 200, 200, 200, 200, 200, 429]);
    expect(transport).toHaveBeenCalledTimes(6);
    now = 60_000;
    expect((await handle(request())).status).toBe(200);
  });
  it('proxies GET presets, caches them for 60 seconds, and respects upstream live restrictions', async () => {
    let now = 0;
    const { handle, transport } = setup({ now: () => now, allowLive: () => true });
    transport.mockImplementation(async () => Response.json({ presets, defaultMode: 'mock', liveBlocked: true, secret: 'private' }));
    const get = () => handle(new Request(`${origin}/api/attack-demo`));
    expect(await (await get()).json()).toEqual({ presets, defaultMode: 'mock', liveBlocked: true });
    await get(); expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer test-secret' } });
    now = 60_000; await get(); expect(transport).toHaveBeenCalledTimes(2);
  });
  it('rechecks the live fence for cached presets and subsequent POSTs', async () => {
    let enabled = true;
    const { handle, transport } = setup({ allowLive: () => enabled });
    transport.mockResolvedValueOnce(Response.json({ presets, defaultMode: 'mock' }));
    const get = () => handle(new Request(`${origin}/api/attack-demo`));
    expect(await (await get()).json()).toMatchObject({ defaultMode: 'mock', liveBlocked: false });
    enabled = false;
    expect(await (await get()).json()).toMatchObject({ defaultMode: 'mock', liveBlocked: true });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await (await handle(request({ text: 'Attack', mode: 'live' }))).json()).toMatchObject({ mode: 'mock', liveBlocked: true });
    expect(JSON.parse(transport.mock.calls[1]![1]!.body as string).mode).toBe('mock');
  });
});
