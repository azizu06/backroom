import { afterEach, expect, it, vi } from 'vitest';
import { MemoryStateStore, getStateStore, installStateStore } from '@backroom/orchestrator';
import { GET } from '../../app/api/agents/cost/route';

vi.mock('server-only', () => ({}));
const origin = 'https://backroom.test';
const originalStore = getStateStore();
afterEach(async () => { await installStateStore(originalStore); vi.unstubAllEnvs(); });
function request(query = '', sentOrigin: string | null = origin) {
  vi.stubEnv('WEBAUTHN_ORIGIN', origin);
  vi.stubEnv('TOOL_GATEWAY_SECRET', 'private-test-bearer');
  return new Request(`${origin}/api/agents/cost${query}`, {
    headers: sentOrigin === null ? {} : { origin: sentOrigin },
  });
}

it('rejects foreign Origin with a no-store 403', async () => {
  const response = await GET(request('', 'https://foreign.test'));
  expect(response.status).toBe(403);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ error: 'ORIGIN_REJECTED' });
});

it('rejects invalid, duplicate and unknown query fields', async () => {
  for (const query of ['?source=live', '?invoiceId=', '?runId=', '?source=demo&source=recorded',
    '?invoiceId=a&invoiceId=b', '?runId=a&runId=b', '?unexpected=1']) {
    const response = await GET(request(query));
    expect(response.status, query).toBe(400);
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
});

it('returns schemaVersion 1 from the shared seeded store without changing it or leaking text', async () => {
  const store = new MemoryStateStore();
  await installStateStore(store);
  await store.appendAudit({ ts: 1, actor: 'local_model', seat: 'collections', action: 'call_plan', route: 'local',
    inputs: { model: 'qwen3:8b', runId: 'run-1', invoiceId: '1042', inputTokens: 100, outputTokens: 20,
      prompt: 'private customer speech', customerText: 'private invoice details' },
    refs: ['1042'], policyVersion: 1, ruleIds: [], costUsd: 0, latencyMs: 125 });
  const before = await store.listAudit();
  const response = await GET(request('?source=recorded&runId=run-1&invoiceId=1042', null));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = await response.json();
  expect(body).toMatchObject({ schemaVersion: 1, source: 'recorded', simulated: false,
    totals: { calls: 1, costUsd: 0, inputTokens: 100, outputTokens: 20, latencyMs: 125 },
    runs: [{ runId: 'run-1' }], invoices: [{ invoiceId: '1042' }] });
  expect(JSON.stringify(body)).not.toMatch(/private|Bearer|prompt|customerText/);
  expect(await store.listAudit()).toEqual(before);
  const filtered = await GET(request('?invoiceId=other'));
  expect(await filtered.json()).toMatchObject({ totals: { calls: 0 } });
});

it('labels explicit demo data simulated and leaves the shared store unchanged', async () => {
  const before = await getStateStore().listAudit();
  const response = await GET(request('?source=demo'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ schemaVersion: 1, source: 'demo', simulated: true,
    totals: { calls: 10, costUsd: .021 } });
  expect(await getStateStore().listAudit()).toEqual(before);
});

it('fails closed when origin or gateway secret is unconfigured', async () => {
  const req = request();
  vi.stubEnv('WEBAUTHN_ORIGIN', '');
  expect((await GET(req)).status).toBe(403);
  vi.stubEnv('WEBAUTHN_ORIGIN', origin);
  vi.stubEnv('TOOL_GATEWAY_SECRET', '');
  const response = await GET(req);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'GATEWAY_NOT_CONFIGURED' });
});

it('returns a sanitized 503 on unavailable recorded usage without falling back to demo', async () => {
  vi.spyOn(getStateStore(), 'listAudit').mockRejectedValueOnce(new Error('private upstream details'));
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'USAGE_UNAVAILABLE' });
});
