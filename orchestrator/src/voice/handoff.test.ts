import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { createHandoffHandler } from './handoff';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup(budget = 1000) {
  const cacheDir = await mkdtemp(join(process.cwd(), '.env.handoff-test-')); directories.push(cacheDir);
  const http = vi.fn(async () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'content-type': 'audio/wav' } }));
  const handler = createHandoffHandler({ cacheDir, characterBudget: budget, apiKey: () => 'key', secret: () => 'private', http });
  return { handler, http, cacheDir };
}
function request(body: unknown, auth = 'Bearer private') {
  return new Request('http://localhost/api/voice/handoff', { method: 'POST', headers: { authorization: auth }, body: JSON.stringify(body) });
}
it('authenticates before synthesis and serves repeat handoffs from disk across handler restarts', async () => {
  const { handler, http, cacheDir } = await setup();
  const body = { role: 'extractor', text: 'Extractor to Vendor verifier: invoice 4419 is ready for checks.' };
  expect((await handler(request(body, 'Bearer wrong'))).status).toBe(401);
  expect(http).not.toHaveBeenCalled();
  const response = await handler(request(body));
  expect(response.status).toBe(200); expect(response.headers.get('content-type')).toBe('audio/wav');
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70]));
  const restarted = createHandoffHandler({ cacheDir, characterBudget: 0, apiKey: () => undefined, secret: () => 'private', http });
  expect((await restarted(request(body))).status).toBe(200);
  expect(http).toHaveBeenCalledTimes(1);
});
it('deduplicates concurrent requests and reserves budget before concurrent provider work', async () => {
  const { handler, http } = await setup(5);
  const pair = await Promise.all([handler(request({ role: 'extractor', text: 'Hello' })), handler(request({ role: 'extractor', text: 'Hello' }))]);
  expect(pair.map(r => r.status)).toEqual([200, 200]); expect(http).toHaveBeenCalledTimes(1);
  expect((await handler(request({ role: 'auditor', text: 'Hello' }))).status).toBe(429);
  expect(http).toHaveBeenCalledTimes(1);
});
it.each([
  { role: 'unknown', text: 'Hello' }, { role: 'toString', text: 'Hello' },
  { role: 'extractor', text: '' }, { role: 'extractor', text: 'x'.repeat(241) },
  { role: 'extractor', text: '<break/>' }, { role: 'extractor', text: 'Hello', voice_id: 'custom' },
])('rejects invalid/unbounded synthesis input without network: %j', async body => {
  const { handler, http } = await setup(); expect((await handler(request(body))).status).toBe(400);
  expect(http).not.toHaveBeenCalled();
});
it('keeps provider failures private and counts ambiguous attempts against the budget', async () => {
  const { cacheDir } = await setup();
  const http = vi.fn(async () => new Response('private provider details', { status: 503 }));
  const handler = createHandoffHandler({ cacheDir, characterBudget: 5, secret: () => 'private', apiKey: () => 'key', http });
  const response = await handler(request({ role: 'extractor', text: 'Hello' }));
  expect(response.status).toBe(502); expect(await response.text()).not.toContain('private provider details');
  expect((await handler(request({ role: 'extractor', text: 'Hello' }))).status).toBe(429);
  expect(http).toHaveBeenCalledTimes(1);
});
it('serves binary WAV through the Node endpoint and rejects oversized HTTP input', async () => {
  const { createServer } = await import('node:http');
  const { createHandoffListener } = await import('./handoff-server');
  const { getHandoffAudio } = await import('./handoff-client');
  const { handler, http } = await setup();
  const server = createServer(createHandoffListener(handler));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const transport: typeof fetch = (url, init) => fetch(`${base}${url}`, { ...init,
      headers: { ...init?.headers, authorization: 'Bearer private' } });
    const audio = await getHandoffAudio({ role: 'auditor', text: 'Audit ready.' }, transport);
    expect(new Uint8Array(await audio.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70]));
    const oversized = await fetch(`${base}/api/handoff`, { method: 'POST', body: 'x'.repeat(4097) });
    expect(oversized.status).toBe(413); expect(http).toHaveBeenCalledTimes(1);
    expect((await fetch(`${base}/api/handoff`)).status).toBe(401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
it('requires server credentials and a valid process budget', async () => {
  const { cacheDir, http } = await setup();
  const unavailable = createHandoffHandler({ cacheDir, secret: () => undefined, http });
  expect((await unavailable(request({ role: 'auditor', text: 'Ready.' }))).status).toBe(503);
  expect(() => createHandoffHandler({ characterBudget: NaN })).toThrow('INVALID_TTS_BUDGET');
  expect(http).not.toHaveBeenCalled();
});
