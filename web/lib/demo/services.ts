import { resolve } from 'node:path';
import { FileClaims, MemoryBalanceDisplayCache, NessieClient, seedNorthfield } from '@backroom/nessie';
import { createCachedCrsClientFromEnv, createCrsFixtureClient, createPreCallHealthCheck, APIFY_DEMO_COMPANY,
  northfield, runPreCall, createPreCallCreditCheck, createCallPlanner, route, recordSignals, signalsFromCrs, signalsFromHealth,
  type PreCallResult, type HealthResult, type StateStore } from '@backroom/orchestrator';
import type { DemoStatus, HealthRow } from '../../../tools/demo/health';
import type { PrecallEvidence } from '../calls/precall';

const root = globalThis as typeof globalThis & { backroomDemoServiceStatus?: () => DemoStatus['services'] };
/** Safe server-only observation for the real-vs-sim route; never initiates a probe. */
export const getDemoHostServices = () => root.backroomDemoServiceStatus?.() ?? null;
export function installDemoServiceStatus(read: () => DemoStatus['services']) { root.backroomDemoServiceStatus = read; }

/** Adapters belong to the web host, survive company resets, and never serialize credentials. */
export async function createDemoServices(options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; modelRoute?: typeof route } = {}) {
  const env = options.env ?? process.env, http = options.fetch ?? fetch;
  const live = env.DEMO_LIVE === '1';
  if (live && !env.NESSIE_API_KEY) throw new Error('DEMO_NESSIE_KEY_REQUIRED');
  const claims = new FileClaims(resolve(env.NESSIE_CLAIMS_DIR || '.nessie-state/claims'));
  const deposits: unknown[] = [], mockClaims = new Set<string>();
  const displayCache = new MemoryBalanceDisplayCache();
  const bank = new NessieClient(live ? { apiKey: env.NESSIE_API_KEY!, surface: 'nessie_sandbox', claims, fetch: http, readAttempts: 1, timeoutMs: 5000, displayCache } : {
    apiKey: 'mock-no-network', surface: 'mock', claims: { async claim(key) { if (mockClaims.has(key)) return false; mockClaims.add(key); return true; } }, displayCache,
    fetch: async (url, init) => {
      if (init?.method === 'POST') {
        const row = { ...JSON.parse(String(init.body)), _id: `mock-deposit-${deposits.length + 1}` };
        deposits.push(row); return Response.json({ objectCreated: row });
      }
      return Response.json(String(url).includes('/deposits') ? deposits : { balance: northfield.bankAccounts.find(row => row.id === 'receivables')!.balanceCents / 100 });
    },
  });
  const accountId = live ? env.NESSIE_ACCOUNT_ID || (await seedNorthfield(bank, claims)).account._id : 'mock-northfield';
  // Default under .demo so a live host caches without a new env var. Offline never builds this client.
  const crsCacheFile = env.CRS_CACHE_FILE?.trim() || resolve('.demo/crs-evidence-cache.json');
  const realCrs = live ? createCachedCrsClientFromEnv({ ...env, CRS_CACHE_FILE: crsCacheFile }, http) : undefined;
  const crs = realCrs ?? createCrsFixtureClient();
  // The pre-call decision stays on the uncached client. Cached evidence is wall/audit only and cannot turn a hold into a pass.
  const credit = createPreCallCreditCheck({ ...env, PRECALL_CRS: realCrs ? 'live' : 'fake' }, http);
  // DEMO_LIVE still probes Apify once. An explicit fake label keeps the fixture checker, with no Actor call.
  const apifyLive = live && env.PRECALL_APIFY !== 'fake';
  const healthCheck = createPreCallHealthCheck({ ...env, PRECALL_APIFY: apifyLive ? 'live' : 'fake' }, http);
  let preflight: Promise<void> | undefined;
  let apify: { mode: string; status: string; runId?: string } = { mode: apifyLive ? 'live' : 'FAKE', status: 'not_probed' };
  let crsStatus = 'not_probed';
  let preCall: PreCallResult | undefined;
  let evidence: { health?: HealthResult; crs?: unknown[] } = {};
  // One Actor attempt per owned host, including failed/ambiguous starts. Reset never re-bills.
  function prepare() {
    return preflight ??= (async () => {
      await Promise.all([
        (async () => {
          try {
            const result = await healthCheck.check(APIFY_DEMO_COMPANY, AbortSignal.timeout(40000));
            evidence.health = result;
            apify = { mode: apifyLive ? 'live' : 'FAKE', status: apifyLive && !result.apifyRunId ? 'pending' : 'complete', ...(result.apifyRunId ? { runId: result.apifyRunId } : {}) };
          } catch { apify = { mode: apifyLive ? 'live' : 'FAKE', status: 'unavailable_no_retry' }; }
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
    services: { preCall: preCall ? { status: preCall.status, ...(preCall.status === 'blocked' ? { reason: preCall.reason } : {}),
      ...(preCall.status === 'ready' ? { signals: preCall.signals } : {}) } : { status: 'not_prepared' }, model: { mode: live ? 'GX10_then_Anthropic' : 'OFF', cloud: preCall?.status === 'ready' && preCall.route === 'cloud' ? 'inference_observed' : env.ANTHROPIC_API_KEY ? 'configured_not_probed' : 'missing' },
      nessie: { mode: live ? 'sandbox' : 'mock' }, apify: { ...apify },
      crs: { mode: realCrs ? 'sandbox' : 'FAKE', status: crsStatus, products: ['publicRecords', 'fraudRisk'], ofac: 'unavailable', businessCredit: 'unavailable' } } });
  // The same Apify rows prepare() records, rebuilt from its cached evidence.
  const precall = (): PrecallEvidence => ({ preCall: { ...status().services.preCall,
    ...(preCall?.status === 'ready' && preCall.warnings ? { warnings: preCall.warnings } : {}) },
    signals: evidence.health ? signalsFromHealth('1042', evidence.health, healthCheck.label ?? 'provided') : [] });
  return { bank, accountId, status, precall,
    async prepare(state: StateStore) {
      if (!live) return;
      await prepare();
      await state.appendAudit({ ts: Date.now(), actor: 'code', seat: 'collections', action: 'demo_pre_call_evidence',
        ruleIds: [], policyVersion: (await state.getPolicy()).policyVersion, refs: ['1042'], route: 'code', latencyMs: 0, costUsd: 0,
        inputs: { noDial: true, syntheticCaller: true, crsLabel: realCrs ? 'SANDBOX: test identity #1' : 'FAKE: test identity #1',
          apify, crsStatus, ...evidence, ofac: 'unknown', businessCredit: 'unavailable' } });
      const invoice = northfield.arInvoices.find(row => row.id === '1042')!;
      const client = northfield.clients.find(row => row.id === invoice.clientId)!;
      if (client.type !== 'business' && client.type !== 'consumer') throw new Error('DEMO_CLIENT_TYPE');
      // Rows describe evidence already fetched. A store miss must not change the pre-call result below.
      try {
        const rows = [
          ...(evidence.crs ?? []).flatMap(item => signalsFromCrs(invoice.id, item as Parameters<typeof signalsFromCrs>[1])),
          ...(evidence.health ? signalsFromHealth(invoice.id, evidence.health, healthCheck.label ?? 'provided') : []),
        ];
        const counts = await recordSignals(state as unknown as Parameters<typeof recordSignals>[0], rows);
        if (counts.failed > 0) console.error('demo signal recording failed', { failed: counts.failed });
      } catch (error) {
        console.error('demo signal recording failed', error);
      }
      // Scripted pre-call only: synthetic consent and an explicitly logged weekend override.
      // The separate preverified gateway rehearsal is not evidence of a live dial permit.
      preCall = await runPreCall({ clientId: client.id, invoiceId: invoice.id, testIdentityId: 7,
        company: APIFY_DEMO_COMPANY, context: { policy: await state.getPolicy(),
          client: { ...client, type: client.type, localWeekday: 6, localHour: 11 },
          demoOverride: { visible: true, logged: true }, signals: {} } }, {
        credit, health: { label: healthCheck.label, async check() {
          if (!evidence.health) throw new Error('Cached health check unavailable');
          return evidence.health;
        } }, planner: createCallPlanner({ cloudRoute: options.modelRoute ?? route }), audit: state,
        escalate: async (decision, refs) => { await state.createCallEscalation({ id: `demo:precall:${Date.now()}`,
          taskId: 'demo:precall', fromAgent: 'demo:precall', seat: 'collections', toHuman: decision.toHuman,
          ruleIds: decision.ruleIds, evidenceRefs: refs, policyVersion: decision.policyVersion, quote: decision.quote }, Date.now()); },
      });
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
      const cloudObserved = preCall?.status === 'ready' && preCall.route === 'cloud';
      rows.push({ name: 'Anthropic', ok: cloudObserved, detail: cloudObserved ? 'web host pre-call inference succeeded; schema/policy validated' : env.ANTHROPIC_API_KEY ? 'Anthropic configured in host; inference not observed' : 'Anthropic key missing in host' },
        { name: 'Pre-call plan', ok: preCall?.status === 'ready', detail: `${preCall?.status ?? 'not prepared'}; synthetic preparation only, never a live dial permit` },
        { name: 'Apify', ok: apify.mode === 'live' && apify.status === 'complete', detail: `${apify.mode}: ${apify.status}; at most one $0.10 Actor attempt per host` },
        { name: 'CRS', ok: !!realCrs && crsStatus === 'complete', detail: `${realCrs ? 'sandbox' : 'FAKE fixture client'}: ${crsStatus}; public records/fraud risk only; OFAC/business credit unavailable` });
      return rows;
    },
  };
}
