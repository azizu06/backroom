import { expect, it, vi } from 'vitest';
import { createCostSummaryHandler, createRecordedCostReader } from './cost-api';
import { MemoryStateStore } from '../store';

const request = (query = '', method = 'GET', auth = 'Bearer test') => new Request(`http://localhost/api/costs${query}`, {
  method, headers: { authorization: auth },
});

it('serves deterministic AP/AR offline costs only on explicit demo source; supports invoice/run filters', async () => {
  const recorded = vi.fn(async () => []);
  const handler = createCostSummaryHandler({ secret: () => 'test', recorded });
  const response = await handler(request('?source=demo'));
  const demo = await response.json();
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(demo).toMatchObject({ schemaVersion: 1, simulated: true, totals: { calls: 10, costUsd: .021,
    localCalls: 2, cloudCalls: 8, inputTokens: 10700, outputTokens: 1090 }, invoices: expect.any(Array) });
  expect(demo.invoices.map((i: { invoiceId: string }) => i.invoiceId)).toEqual(['1042', '4401']);
  expect(await (await handler(request('?source=demo'))).json()).toEqual(demo);
  const filtered = await (await handler(request('?source=demo&invoiceId=4401&runId=demo-ap-4401%3Aextractor'))).json();
  expect(filtered.totals).toMatchObject({ calls: 2, costUsd: .002, localShare: .5 });
  expect(recorded).not.toHaveBeenCalled();
  expect(await (await handler(request())).json()).toMatchObject({ source: 'recorded', simulated: false, totals: { calls: 0 } });
});

it('protects costs, rejects writes/invalid queries and fails closed without switching to demo', async () => {
  const recorded = vi.fn(async () => { throw new Error('private upstream details'); });
  const handler = createCostSummaryHandler({ secret: () => 'test', recorded });
  expect((await handler(request('', 'GET', ''))).status).toBe(401);
  expect((await createCostSummaryHandler({ secret: () => undefined })(request())).status).toBe(503);
  expect((await handler(request('', 'POST'))).status).toBe(405);
  for (const query of ['?source=live', '?invoiceId=', '?runId=a&runId=b', '?unexpected=1']) {
    expect((await handler(request(query))).status).toBe(400);
  }
  expect(recorded).not.toHaveBeenCalled();
  const failed = await handler(request());
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: 'USAGE_UNAVAILABLE' });
});

it('reads existing audit records without mutation; keeps ambiguous refs unassigned until host supplies linkage', async () => {
  const store = new MemoryStateStore();
  await store.appendAudit({ ts: 1, actor: 'local_model', seat: 'collections', action: 'call_plan', route: 'local',
    inputs: { model: 'qwen3:8b' }, refs: ['client', '1042'], policyVersion: 1, ruleIds: [], costUsd: 0, latencyMs: 100 });
  const before = await store.listAudit();
  const reader = createRecordedCostReader({ store: () => store });
  expect((await reader())[0]).toMatchObject({ invoiceId: null, execution: 'local', costUsd: 0 });
  const linked = createRecordedCostReader({ store: () => store, linkAudit: () => ({ runId: 'ar', invoiceId: '1042' }) });
  expect((await linked())[0]).toMatchObject({ runId: 'ar', invoiceId: '1042' });
  expect(await store.listAudit()).toEqual(before);
});
