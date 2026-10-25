import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { route, signalsFromCrs, signalsFromHealth } from '@backroom/orchestrator';
import { precallCard } from '../calls/precall';
import { createDemoServices } from './services';

mkdirSync('.demo', { recursive: true });
const claimsDir = mkdtempSync(resolve('.demo/unit-claims-'));
const defaultCrsCache = resolve('.demo/crs-evidence-cache.json');
afterEach(() => { vi.unstubAllEnvs(); rmSync(claimsDir, { recursive: true, force: true }); rmSync(defaultCrsCache, { force: true }); });
it('keeps rehearsal offline even when sponsor credentials are present', async () => {
  const http = vi.fn();
  const cacheFile = resolve(claimsDir, 'crs.json');
  const services = await createDemoServices({ env: { NODE_ENV: 'test', NESSIE_API_KEY: 'private', CRS_USERNAME: 'user', CRS_PASSWORD: 'secret', CRS_CACHE_FILE: cacheFile }, fetch: http });
  expect(services.status().bank).toBe('mock');
  expect(services.status().services.crs.mode).toBe('FAKE');
  expect(existsSync(cacheFile)).toBe(false);
  expect((await services.bank.readBalanceWithPostedDeposits(services.accountId)).sandboxLabel).toBe('Mock bank (offline)');
  expect(http).not.toHaveBeenCalled();
});
it('live payments use real Nessie HTTP and reuse invoice memos across new hosts', async () => {
  const deposits: unknown[] = [];
  const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const row = { ...JSON.parse(String(init.body)), _id: 'sandbox-deposit' }; deposits.push(row);
      return Response.json({ objectCreated: row });
    }
    return Response.json(String(url).includes('/deposits') ? deposits : { balance: 0 });
  });
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', DEMO_LIVE: '1', NESSIE_API_KEY: 'private', NESSIE_ACCOUNT_ID: 'sandbox-account', NESSIE_CLAIMS_DIR: claimsDir };
  const first = await createDemoServices({ env, fetch: http });
  const payment = { accountId: first.accountId, invoiceId: '1042', installment: 1, amountCents: 247500 };
  expect((await first.bank.deposit(payment)).description).toBe('backroom:invoice=1042:installment=1');
  const again = await createDemoServices({ env, fetch: http });
  await again.bank.deposit(payment);
  expect(http.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  expect((await first.bank.readBalanceWithPostedDeposits(first.accountId)).sandboxLabel).toBe('Nessie = sandbox bank');
  expect(first.status()).toMatchObject({ live: true, bank: 'nessie_sandbox', services: { crs: { mode: 'FAKE' } } });
  expect(JSON.stringify(first.status())).not.toContain('private');
});

it('caches even an ambiguous Actor start across resets and reports it without leaking provider text', async () => {
  const http = vi.fn<typeof fetch>(async () => { throw new Error('private-provider-error'); });
  const services = await createDemoServices({ env: { NODE_ENV: 'test', DEMO_LIVE: '1', NESSIE_API_KEY: 'private',
    NESSIE_ACCOUNT_ID: 'sandbox-account', APIFY_TOKEN: 'private-token' }, fetch: http,
    modelRoute: async () => ({ kind: 'LLM_OFF', route: 'code', model: 'none', latencyMs: 0, costUsd: 0 }) });
  const { MemoryStateStore } = await import('@backroom/orchestrator');
  const first = new MemoryStateStore(), reset = new MemoryStateStore();
  await services.prepare(first);
  await services.prepare(reset);
  expect(http).toHaveBeenCalledTimes(1);
  const [url] = http.mock.calls[0]!;
  expect(new URL(String(url)).searchParams.get('maxTotalChargeUsd')).toBe('0.10');
  expect(services.status().services.apify.status).toBe('unavailable_no_retry');
  const audit = await reset.listAudit();
  expect(audit[0]?.inputs).toMatchObject({ noDial: true, crsLabel: 'FAKE: test identity #1', ofac: 'unknown' });
  expect(JSON.stringify([audit, services.status()])).not.toContain('private');
});

it('consumes the CRS pre-call factory and blocks bankruptcy before model planning', async () => {
  const http: typeof fetch = async url => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/users/login')) return Response.json({ token: 'test-session' });
    if (path.includes('/pp/')) return Response.json({ Report: { Summary: { BankruptciesFound: '1', JudgmentsFound: '0', LiensFound: '0' } } });
    if (path.includes('/fraud-finder/')) return Response.json({ risk: { score: 88, tumbling_risk: 0 } });
    throw new Error('Unexpected network');
  };
  const modelRoute = vi.fn();
  const services = await createDemoServices({ env: { NODE_ENV: 'test', DEMO_LIVE: '1', NESSIE_API_KEY: 'private',
    NESSIE_ACCOUNT_ID: 'sandbox-account', CRS_USERNAME: 'test-user', CRS_PASSWORD: 'test-pass' }, fetch: http, modelRoute });
  const { MemoryStateStore } = await import('@backroom/orchestrator');
  const state = new MemoryStateStore();
  await services.prepare(state);
  expect(services.status().services.preCall).toMatchObject({ status: 'blocked' });
  expect((await state.listAudit()).some(row => row.ruleIds.includes('BANKRUPTCY_STOP'))).toBe(true);
  expect(modelRoute).not.toHaveBeenCalled();
});

it('shows a labelled cached balance when Nessie is down', async () => {
  let down = false;
  const http = vi.fn(async (url: string | URL | Request) => {
    if (down) throw new Error('nessie-down');
    return Response.json(String(url).includes('/deposits') ? [] : { balance: 80 });
  });
  const services = await createDemoServices({ env: { NODE_ENV: 'test', DEMO_LIVE: '1', NESSIE_API_KEY: 'private',
    NESSIE_ACCOUNT_ID: 'sandbox-account', NESSIE_CLAIMS_DIR: claimsDir }, fetch: http });
  const live = await services.bank.readBalanceDisplay(services.accountId);
  expect(live).toMatchObject({ cached: false, freshness: 'live', displayTotal: 80 });
  down = true;
  const cached = await services.bank.readBalanceDisplay(services.accountId);
  expect(cached).toMatchObject({ cached: true, displayTotal: 80, accountBalance: 80 });
  expect(cached.freshness).toMatch(/^cached at \d\d:\d\d UTC$/);
});

it('audits cached CRS evidence and still blocks the pre-call when CRS is down', async () => {
  let down = false;
  const http: typeof fetch = async url => {
    if (down) throw new Error('crs-down');
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/users/login')) return Response.json({ token: 'test-session', refreshToken: 'refresh' });
    if (path.includes('/pp/')) return Response.json({ Report: { Summary: { BankruptciesFound: '0', JudgmentsFound: '0', LiensFound: '0' } } });
    if (path.includes('/fraud-finder/')) return Response.json({ risk: { score: 10, tumbling_risk: 0 } });
    throw new Error('unexpected');
  };
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', DEMO_LIVE: '1', NESSIE_API_KEY: 'private',
    NESSIE_ACCOUNT_ID: 'sandbox-account', NESSIE_CLAIMS_DIR: claimsDir, CRS_USERNAME: 'test-user', CRS_PASSWORD: 'test-pass' };
  const plannerCalls: unknown[] = [];
  const modelRoute: typeof route = async (...args) => {
    plannerCalls.push(args);
    return { kind: 'LLM_OFF', route: 'code', model: 'none', latencyMs: 0, costUsd: 0 };
  };
  const { MemoryStateStore } = await import('@backroom/orchestrator');
  const first = await createDemoServices({ env, fetch: http, modelRoute });
  await first.prepare(new MemoryStateStore());
  expect(existsSync(defaultCrsCache)).toBe(true);
  expect(first.status().services.crs.mode).toBe('sandbox');
  expect(first.status().services.preCall.status).toBe('blocked');
  down = true;
  const second = await createDemoServices({ env, fetch: http, modelRoute });
  const state = new MemoryStateStore();
  await second.prepare(state);
  expect(second.status().services.preCall.status).toBe('blocked');
  expect(plannerCalls).toHaveLength(0);
  const wall = (await state.listAudit()).filter(row => row.action === 'demo_pre_call_evidence');
  const crs = (wall.at(-1)?.inputs as { crs?: { cached?: boolean; label?: string; product?: string }[] } | undefined)?.crs;
  expect(crs?.map(row => row.product)).toEqual(['publicRecords', 'fraudRisk']);
  for (const row of crs ?? []) {
    expect(row.cached).toBe(true);
    expect(row.label).toMatch(/\(cached at \d\d:\d\d UTC\)$/);
  }
});

it('records FAKE CRS and fixture health signals, replays as a no-op, and still readies pre-call when the store fails', async () => {
  const http = vi.fn();
  const plan = { tone: 'neutral' as const, offerOrder: ['pay_in_full' as const], plan: { installments: 1, firstPaymentPct: 100, totalDays: 0, waiveFees: false, discountPct: 0 } };
  const modelRoute = (async () => ({ output: plan, route: 'cloud' as const, model: 'test', latencyMs: 1, costUsd: 0 })) as typeof route;
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', DEMO_LIVE: '1', NESSIE_API_KEY: 'private', NESSIE_ACCOUNT_ID: 'sandbox-account', PRECALL_APIFY: 'fake' };
  const services = await createDemoServices({ env, fetch: http, modelRoute });
  const { MemoryStateStore } = await import('@backroom/orchestrator');
  const state = new MemoryStateStore();
  await services.prepare(state);
  expect(services.status().services.preCall.status).toBe('ready');
  expect(services.status().services.crs.mode).toBe('FAKE');
  expect(services.status().services.apify).toMatchObject({ mode: 'FAKE', status: 'complete' });
  const audit = await state.listAudit();
  expect(audit.find(row => row.action === 'health_check')?.inputs).toMatchObject({ label: 'FAKE' });
  const inputs = audit.find(row => row.action === 'demo_pre_call_evidence')?.inputs as { crs?: Parameters<typeof signalsFromCrs>[1][]; health?: Parameters<typeof signalsFromHealth>[1] } | undefined;
  const expected = [
    ...(inputs?.crs ?? []).flatMap(row => signalsFromCrs('1042', row)),
    ...(inputs?.health ? signalsFromHealth('1042', inputs.health, 'FAKE') : []),
  ];
  expect(expected.length).toBeGreaterThan(0);
  expect(expected.every(row => row.subjectRef === '1042' && row.source === 'crs_fixture' && row.label === 'FAKE: CRS fixture, test identity #1')).toBe(true);
  expect(expected.some(row => /live run/i.test(row.label))).toBe(false);
  expect(await state.listSignals()).toEqual(expected);
  expect(services.precall()).toEqual({ preCall: { status: 'ready', signals: expect.any(Object) }, signals: expected.filter(row => row.source === 'apify') });
  await services.prepare(state);
  expect(await state.listSignals()).toEqual(expected);
  expect(http).not.toHaveBeenCalled();

  const broken = await createDemoServices({ env, fetch: http, modelRoute });
  const failing = new MemoryStateStore();
  failing.recordSignal = async () => { throw new Error('signal store down'); };
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  await broken.prepare(failing);
  expect(broken.status().services.preCall.status).toBe('ready');
  expect(await failing.listSignals()).toEqual([]);
  expect(logged).toHaveBeenCalledWith('demo signal recording failed', { failed: expected.length });
  logged.mockRestore();
});

it('rebuilds only email-eligible refused calls as trusted planner cases', async () => {
  const plan = { tone: 'neutral' as const, offerOrder: ['pay_in_full' as const],
    plan: { installments: 1, firstPaymentPct: 100, totalDays: 0, waiveFees: false, discountPct: 0 } };
  const modelRoute = (async () => ({ output: plan, route: 'cloud' as const, model: 'test', latencyMs: 1, costUsd: 0 })) as typeof route;
  const services = await createDemoServices({ env: { NODE_ENV: 'test', DEMO_LIVE: '1', NESSIE_API_KEY: 'private',
    NESSIE_ACCOUNT_ID: 'sandbox-account', PRECALL_APIFY: 'fake' }, fetch: vi.fn(), modelRoute });
  const { MemoryStateStore } = await import('@backroom/orchestrator');
  const state = new MemoryStateStore();
  await services.prepare(state);
  const planner = services.collectionsPlanner(state);
  const consumer = await planner.caseFor({ outcome: 'refused', code: 'CALL_DENIED', detail: 'B2B_ONLY_CALLS' });
  expect(consumer).toMatchObject({ precall: { context: { client: { type: 'consumer' } } },
    emailContact: { address: 'billing@client.example' } });
  await expect(planner.voice.start(consumer!.dial)).rejects.toThrow('REFUSED_CALL_CANNOT_DIAL');
  expect(await planner.caseFor({ outcome: 'refused', code: 'CALL_DENIED', detail: 'DNC' }))
    .toMatchObject({ precall: { context: { client: { dnc: true } } } });
  expect(await planner.caseFor({ outcome: 'refused', code: 'CALL_DENIED', detail: 'CONSENT_REQUIRED' }))
    .not.toHaveProperty('precall.context.client.consent');
  expect(await planner.caseFor({ outcome: 'refused', code: 'CALL_DENIED', detail: 'BANKRUPTCY_STOP' })).toBeUndefined();
  expect(await planner.caseFor({ outcome: 'refused', code: 'RELAY_REFUSED', detail: 'B2B_ONLY_CALLS' })).toBeUndefined();
});

it('records the live website signal for invoice 1042 and the card reads that same row', async () => {
  const runId = '7LJbWDdDqZkk5iRJh';
  const observedAt = '2026-10-24T23:54:18.992Z';
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ data: { id: runId, status: 'SUCCEEDED', defaultDatasetId: 'dataset123' } }))
    .mockResolvedValueOnce(Response.json([{ signals: [{ type: 'website_reachable', value: true, sourceUrl: 'http://kimsislandsi.com/', observedAt }] }]));
  const plan = { tone: 'neutral' as const, offerOrder: ['pay_in_full' as const], plan: { installments: 1, firstPaymentPct: 100, totalDays: 0, waiveFees: false, discountPct: 0 } };
  const modelRoute = (async () => ({ output: plan, route: 'cloud' as const, model: 'test', latencyMs: 1, costUsd: 0 })) as typeof route;
  const services = await createDemoServices({ env: { NODE_ENV: 'test', DEMO_LIVE: '1', NESSIE_API_KEY: 'private', NESSIE_ACCOUNT_ID: 'sandbox-account',
    NESSIE_CLAIMS_DIR: claimsDir, APIFY_TOKEN: 'private-token', PRECALL_APIFY: 'live' }, fetch: http, modelRoute });
  const { MemoryStateStore } = await import('@backroom/orchestrator');
  const state = new MemoryStateStore();
  await services.prepare(state);
  expect(services.status().services.apify).toEqual({ mode: 'live', status: 'complete', runId });
  const recorded = (await state.listSignals()).filter(row => row.source === 'apify');
  expect(recorded).toEqual(services.precall().signals);
  expect(recorded).toMatchObject([{ subjectRef: '1042', type: 'apify_website_reachable', value: true, label: `Apify: live run ${runId}`, evidenceRef: runId }]);
  expect(precallCard(services.precall())).toMatchObject({ business: 'unknown', businessDetail: 'Not checked', source: `Apify: live run ${runId}`,
    sourceHost: 'kimsislandsi.com', checkedAt: '23:54 UTC', phoneMatch: 'unknown', status: 'ready' });
  expect(http).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(services.status())).not.toContain('private');
});
