import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createDemoServices } from './services';

mkdirSync('.demo', { recursive: true });
const claimsDir = mkdtempSync(resolve('.demo/unit-claims-'));
afterEach(() => { vi.unstubAllEnvs(); rmSync(claimsDir, { recursive: true, force: true }); });
it('keeps rehearsal offline even when sponsor credentials are present', async () => {
  const http = vi.fn();
  const services = await createDemoServices({ env: { NODE_ENV: 'test', NESSIE_API_KEY: 'private' }, fetch: http });
  expect(services.status().bank).toBe('mock');
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
