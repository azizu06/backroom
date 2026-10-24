import { createServer } from 'node:http';
import { afterEach, expect, test, vi } from 'vitest';
import { createAttackDemoHandler } from './http';
import { createAttackDemoListener } from './server';

const handler = createAttackDemoHandler({ secret: () => 'test-secret' });
const request = (body: unknown, auth = 'Bearer test-secret', method = 'POST') => new Request('http://localhost/api/attack-demo', {
  method, headers: { authorization: auth }, ...(method === 'POST' && { body: JSON.stringify(body) }),
});
afterEach(() => vi.unstubAllGlobals());

test('a trusted controller can discover presets and submit a structured trace request offline', async () => {
  const catalog = await handler(request(undefined, undefined, 'GET'));
  expect(catalog.status).toBe(200);
  expect((await catalog.json()).presets).toHaveLength(4);
  const response = await handler(request({ presetId: 'lookalike-vendor' }));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ mode: 'mock', source: 'judge', moneyMoved: false, paymentAttempts: 0,
    decision: { kind: 'ESCALATE', ruleIds: ['LOOKALIKE_DOMAIN', 'BANK_CHANGE_HOLD'], reason: expect.any(String) } });
});

test.each(['', 'Bearer wrong', 'Basic test-secret'])('rejects unauthorized controller %s without model work', async auth => {
  const response = await handler(request({ presetId: 'prompt-injection', mode: 'live' }, auth));
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'UNAUTHORIZED' });
});

test('fails closed when the shared bearer secret is unconfigured', async () => {
  expect((await createAttackDemoHandler({ secret: () => undefined })(request({ text: 'hi' }))).status).toBe(503);
});

test.each([{}, { text: '' }, { presetId: 'unknown' }, { text: 'x', approved: true }, { text: 'x', mode: 'sonnet' }, { text: 'x'.repeat(16001) }])('rejects invalid input %j', async body => {
  expect((await handler(request(body))).status).toBe(400);
});

test('rejects malformed JSON and bounds streamed bodies', async () => {
  const malformed = new Request('http://localhost/api/attack-demo', { method: 'POST', headers: { authorization: 'Bearer test-secret' }, body: '{' });
  expect((await handler(malformed)).status).toBe(400);
  expect((await handler(request({ text: 'x'.repeat(65536) }))).status).toBe(413);
});

test('live mode requires explicit server opt-in and is never an automatic fallback', async () => {
  vi.stubEnv('ATTACK_DEMO_LIVE', '0');
  try {
    const response = await handler(request({ presetId: 'prompt-injection', mode: 'live' }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'LIVE_NOT_ENABLED' });
  } finally { vi.unstubAllEnvs(); }
});

test('the real loopback listener serves a policy trace and refuses other routes', async () => {
  const server = createServer(createAttackDemoListener(handler));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('NO_TEST_PORT');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const response = await fetch(`${base}/api/attack-demo`, { method: 'POST', headers: { authorization: 'Bearer test-secret' }, body: JSON.stringify({ presetId: 'split-invoice' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ decision: { kind: 'ESCALATE', ruleIds: ['OVER_LIMIT', 'NO_PO'] }, moneyMoved: false });
    expect((await fetch(`${base}/not-an-endpoint`)).status).toBe(404);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
