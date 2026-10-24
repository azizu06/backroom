import { expect, it, vi } from 'vitest';
import { createApifyRunner, createPreCallHealthCheck } from './apify';
import { runPreCall } from './index';
import { MemoryStateStore } from '../store';
import { createApifyHealthCheck } from './adapters';

const company = { name: 'Public demo company', website: 'https://example.com' };
const signal = { type: 'website_reachable', value: true, sourceUrl: company.website, observedAt: '2026-10-24T09:00:00Z' };

it('runs the pinned Actor once with a cost/runtime cap and returns validated signals with its run ID', async () => {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: { id: 'run123', status: 'SUCCEEDED', defaultDatasetId: 'dataset123' } }))
    .mockResolvedValueOnce(Response.json([{ signals: [signal], rawHtml: 'untrusted' }]));
  const check = createApifyHealthCheck(createApifyRunner({ token: 'private-token', fetch: http }));
  expect(await check.check(company, new AbortController().signal)).toEqual({ signals: [signal], apifyRunId: 'run123' });
  const [url, request] = http.mock.calls[0]!;
  expect(String(url)).toContain('/actors/WQJ4xRGzZN1xj967Z/runs?');
  const params = new URL(String(url)).searchParams;
  expect(Object.fromEntries(params)).toMatchObject({ build: '0.0.3', timeout: '35', maxTotalChargeUsd: '0.10', restartOnError: 'false' });
  expect(String(url)).not.toContain('private-token');
  expect(JSON.parse(request!.body as string)).toEqual({ companyName: company.name, website: company.website });
  expect(String(http.mock.calls[1]![0])).toContain('/datasets/dataset123/items?');
  expect(http).toHaveBeenCalledTimes(2);
});


function preCall(http: typeof fetch) {
  const audit = new MemoryStateStore();
  const planner = { draft: vi.fn(async () => ({ output: { tone: 'neutral', offerOrder: ['pay_in_full'],
    plan: { installments: 1, firstPaymentPct: 100, totalDays: 0, waiveFees: false, discountPct: 0 } },
    route: 'test', model: 'fixture', latencyMs: 0, costUsd: 0 })) };
  const result = runPreCall({ clientId: 'client-1042', invoiceId: '1042', testIdentityId: 7, company,
    context: { client: { type: 'business', phoneNumber: '+15555550100', dnc: false, localWeekday: 1, localHour: 10,
      consent: { source: 'synthetic', text: 'test consent', timestamp: '2026-10-24T01:00:00Z', number: '+15555550100' } } },
  }, { health: createPreCallHealthCheck({ PRECALL_APIFY: 'live', APIFY_TOKEN: 'private-token' }, http), audit, planner,
    credit: { check: async () => ({ testIdentityId: 7, ofacStatus: 'clear', activeSignals: [], evidence: [] }) },
    escalate: async () => {} });
  return { result, audit, planner };
}

it('degrades schema-invalid output to pending with a redacted code audit', async () => {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: { id: 'run123', status: 'SUCCEEDED', defaultDatasetId: 'dataset123' } }))
    .mockResolvedValueOnce(Response.json([{ signals: 'private-token untrusted page' }]));
  const { result, audit, planner } = preCall(http);
  expect(await result).toMatchObject({ status: 'ready', healthCheckPending: true });
  expect(planner.draft).toHaveBeenCalledWith(expect.objectContaining({ healthCheckPending: true }));
  expect((await audit.listAudit()).find(row => row.action === 'health_check')).toMatchObject({ actor: 'code', inputs: { status: 'pending', signals: [], label: 'Apify: live run pending' } });
  expect(JSON.stringify(await audit.listAudit())).not.toContain('private-token');
});

it('returns health check pending at 40 seconds when HTTP hangs and aborts the boundary', async () => {
  vi.useFakeTimers();
  try {
    let requestSignal: AbortSignal | null | undefined;
    const http = vi.fn<typeof fetch>(async (_url, init) => {
      requestSignal = init?.signal;
      return new Promise<Response>(() => {});
    });
    const { result, audit } = preCall(http);
    await vi.advanceTimersByTimeAsync(39_999);
    expect((await audit.listAudit()).some(row => row.action === 'health_check')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ status: 'ready', healthCheckPending: true, summary: expect.stringContaining('health check pending') });
    expect(requestSignal?.aborted).toBe(true);
    expect(http).toHaveBeenCalledTimes(1);
    expect((await audit.listAudit()).find(row => row.action === 'health_check')).toMatchObject({ inputs: { status: 'pending' }, latencyMs: 40_000 });
  } finally { vi.useRealTimers(); }
});

it('blocks the call in code for a permanently closed business from a real transport response', async () => {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: { id: 'closedRun', status: 'SUCCEEDED', defaultDatasetId: 'dataset123' } }))
    .mockResolvedValueOnce(Response.json([{ signals: [{ ...signal, type: 'maps_status', value: 'permanently_closed' }] }]));
  const { result, audit, planner } = preCall(http);
  expect(await result).toMatchObject({ status: 'blocked', decision: { ruleIds: ['CLOSED_BUSINESS_STOP'] } });
  expect(planner.draft).not.toHaveBeenCalled();
  expect((await audit.listAudit()).find(row => row.action === 'health_check')).toMatchObject({ inputs: { label: 'Apify: live run closedRun', runId: 'closedRun' } });
});

it.each([undefined, '', 'fake', 'LIVE'])('never uses HTTP without the exact opt-in (%s)', async flag => {
  const http = vi.fn<typeof fetch>();
  const check = createPreCallHealthCheck({ PRECALL_APIFY: flag }, http);
  expect(await check.check(company, new AbortController().signal)).toEqual({ signals: [] });
  expect(check.label).toBe('FAKE');
  expect(http).not.toHaveBeenCalled();
});

it.each(['RUNNING', 'FAILED', 'TIMED-OUT'])('does not retry or accept partial results for %s runs', async status => {
  const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ data: { id: 'run123', status, defaultDatasetId: 'dataset123' } }));
  const { result } = preCall(http);
  expect(await result).toMatchObject({ status: 'ready', healthCheckPending: true });
  expect(http).toHaveBeenCalledTimes(1);
});

it('surfaces the live run in the core demo and retains a valid audit chain', async () => {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: { id: 'demoLiveRun', status: 'SUCCEEDED', defaultDatasetId: 'dataset123' } }))
    .mockResolvedValueOnce(Response.json([{ signals: [signal] }]));
  vi.stubGlobal('fetch', http);
  vi.stubEnv('APIFY_TOKEN', 'private-token');
  try {
    const { runCoreDemo } = await import('../core-demo/core');
    const demo = await runCoreDemo({ apify: 'live' });
    expect(demo.chainValid).toBe(true);
    expect(demo.preCall).toMatchObject({ status: 'ready', healthCheckPending: false });
    expect(demo.transcript).toContain('Pre-call health: Apify: live run demoLiveRun; complete.');
    expect(demo.entries.find(row => row.action === 'health_check')).toMatchObject({ inputs: { runId: 'demoLiveRun', label: 'Apify: live run demoLiveRun' } });
    expect(http).toHaveBeenCalledTimes(2);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
