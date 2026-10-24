import { resolve } from 'node:path';
import { FileClaims, NessieClient, seedNorthfield } from '@backroom/nessie';
import { createCrsClientFromEnv, createCrsFixtureClient, createPreCallHealthCheck, APIFY_DEMO_COMPANY,
  northfield, type HealthResult, type StateStore } from '@backroom/orchestrator';
import type { DemoStatus, HealthRow } from '../../../tools/demo/health';

const root = globalThis as typeof globalThis & { backroomDemoServiceStatus?: () => DemoStatus['services'] };
/** Safe server-only observation for the real-vs-sim route; never initiates a probe. */
export const getDemoHostServices = () => root.backroomDemoServiceStatus?.() ?? null;
export function installDemoServiceStatus(read: () => DemoStatus['services']) { root.backroomDemoServiceStatus = read; }

/** Adapters belong to the web host, survive company resets, and never serialize credentials. */
export async function createDemoServices(options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}) {
  const env = options.env ?? process.env, http = options.fetch ?? fetch;
  const live = env.DEMO_LIVE === '1';
  if (live && !env.NESSIE_API_KEY) throw new Error('DEMO_NESSIE_KEY_REQUIRED');
  const claims = new FileClaims(resolve(env.NESSIE_CLAIMS_DIR || '.nessie-state/claims'));
  const deposits: unknown[] = [], mockClaims = new Set<string>();
  const bank = new NessieClient(live ? { apiKey: env.NESSIE_API_KEY!, claims, fetch: http, readAttempts: 1, timeoutMs: 5000 } : {
    apiKey: 'mock-no-network', claims: { async claim(key) { if (mockClaims.has(key)) return false; mockClaims.add(key); return true; } },
    fetch: async (url, init) => {
      if (init?.method === 'POST') {
        const row = { ...JSON.parse(String(init.body)), _id: `mock-deposit-${deposits.length + 1}` };
        deposits.push(row); return Response.json({ objectCreated: row });
      }
      return Response.json(String(url).includes('/deposits') ? deposits : { balance: northfield.bankAccounts.find(row => row.id === 'receivables')!.balanceCents / 100 });
    },
  });
  const accountId = live ? env.NESSIE_ACCOUNT_ID || (await seedNorthfield(bank, claims)).account._id : 'mock-northfield';
  const realCrs = live ? createCrsClientFromEnv(env, http) : undefined;
  const crs = realCrs ?? createCrsFixtureClient();
  const healthCheck = createPreCallHealthCheck({ ...env, PRECALL_APIFY: live ? 'live' : 'fake' }, http);
  let preflight: Promise<void> | undefined;
  let apify: { mode: string; status: string; runId?: string } = { mode: live ? 'live' : 'FAKE', status: 'not_probed' };
  let crsStatus = 'not_probed';
  let evidence: { health?: HealthResult; crs?: unknown[] } = {};
  // One Actor attempt per owned host, including failed/ambiguous starts. Reset never re-bills.
  function prepare() {
    return preflight ??= (async () => {
      await Promise.all([
        (async () => {
          try {
            const result = await healthCheck.check(APIFY_DEMO_COMPANY, AbortSignal.timeout(40000));
            evidence.health = result;
            apify = { mode: live ? 'live' : 'FAKE', status: live && !result.apifyRunId ? 'pending' : 'complete', ...(result.apifyRunId ? { runId: result.apifyRunId } : {}) };
          } catch { apify = { mode: live ? 'live' : 'FAKE', status: 'unavailable_no_retry' }; }
        })(),
        (async () => {
          try {
            // Exact sponsor persona P01. These are public-record/fraud checks, never OFAC/business credit.
            evidence.crs = await Promise.all([crs.getPublicRecords(1), crs.getFraudRisk(1)]);
            crsStatus = 'complete';
          } catch { crsStatus = 'unavailable'; }
        })(),
      ]);
    })();
  }
  const status = () => ({ live, bank: live ? 'nessie_sandbox' as const : 'mock' as const,
    services: { model: { mode: live ? 'GX10_then_Anthropic' : 'OFF', cloud: env.ANTHROPIC_API_KEY ? 'configured_not_probed' : 'missing' },
      nessie: { mode: live ? 'sandbox' : 'mock' }, apify: { ...apify },
      crs: { mode: realCrs ? 'sandbox' : 'FAKE', status: crsStatus, products: ['publicRecords', 'fraudRisk'], ofac: 'unavailable', businessCredit: 'unavailable' } } });
  return { bank, accountId, status,
    async prepare(state: StateStore) {
      if (!live) return;
      await prepare();
      await state.appendAudit({ ts: Date.now(), actor: 'code', seat: 'collections', action: 'demo_pre_call_evidence',
        ruleIds: [], policyVersion: (await state.getPolicy()).policyVersion, refs: ['1042'], route: 'code', latencyMs: 0, costUsd: 0,
        inputs: { noDial: true, syntheticCaller: true, crsLabel: realCrs ? 'SANDBOX: test identity #1' : 'FAKE: test identity #1',
          apify, crsStatus, ...evidence, ofac: 'unknown', businessCredit: 'unavailable' } });
    },
    async health(): Promise<HealthRow[]> {
      const rows: HealthRow[] = [{ name: 'Cartesia key', ok: !!env.CARTESIA_API_KEY, detail: env.CARTESIA_API_KEY ? 'present in web host; not a call-readiness test' : 'missing in web host' }];
      if (!live) return [...rows, { name: 'Nessie', ok: false, detail: 'unused: web host uses mock bank' },
        { name: 'GX10 router', ok: false, detail: 'unused: rehearsal defaults OFF' },
        { name: 'Cloud fallback', ok: false, detail: 'unused: rehearsal defaults OFF' },
        { name: 'Apify', ok: false, detail: 'FAKE rehearsal adapter' }, { name: 'CRS', ok: false, detail: 'FAKE fixture client' }];
      try { await bank.readBalanceWithPostedDeposits(accountId); rows.push({ name: 'Nessie', ok: true, detail: 'web host sandbox adapter read account + posted deposits; not settlement' }); }
      catch { rows.push({ name: 'Nessie', ok: false, detail: 'web host sandbox read unavailable' }); }
      try {
        const response = await http(`${(env.GX10_BASE_URL || 'http://100.117.44.20:11434/v1').replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(4000) });
        const body = await response.json() as { data?: { id: string }[] };
        const ok = response.ok && body.data?.some(row => row.id === (env.GX10_MODEL || 'gpt-oss:20b')) === true;
        rows.push({ name: 'GX10 router', ok, detail: ok ? 'host configured model listed; inference not tested by health' : 'host model unavailable' });
      } catch { rows.push({ name: 'GX10 router', ok: false, detail: 'host model listing unavailable' }); }
      rows.push({ name: 'Cloud fallback', ok: false, detail: env.ANTHROPIC_API_KEY ? 'Anthropic configured in host; inference not probed by health' : 'Anthropic key missing in host' },
        { name: 'Apify', ok: apify.mode === 'live' && apify.status === 'complete', detail: `${apify.mode}: ${apify.status}; at most one $0.10 Actor attempt per host` },
        { name: 'CRS', ok: !!realCrs && crsStatus === 'complete', detail: `${realCrs ? 'sandbox' : 'FAKE fixture client'}: ${crsStatus}; public records/fraud risk only; OFAC/business credit unavailable` });
      return rows;
    },
  };
}
