/** In-app call button: production pre-call, the demo status projection, the dial gate, and the office POST.
 * Fixture credit/health/planner only. The dial stub records providerRequest() and performs no HTTP. */
import { fakeCreditCheck, fakeHealthCheck, runPreCall, type PreCallResult } from '../../collections';
import { MemoryStateStore } from '../../store';
import { createAdminDial } from '../../voice/admin-dial';
import { parsePreCallGate } from '../../voice/demo-bridge';
import { createCallRequestHTTP, type CallRequestAudit } from '../../../../web/lib/calls/request';

const ORIGIN = 'https://demo.example';
const RELAY = { url: 'http://127.0.0.1:8788/_admin/dial', secret: 'admin-secret' };
const PHONE_BODY = { line: 'collections', phoneNumber: '+15555550199' };

/** The services.preCall object web/lib/demo/services.ts publishes. Blocked keeps reason; ready keeps signals. */
function publishPreCall(preCall: PreCallResult | undefined) {
  return preCall ? { status: preCall.status, ...(preCall.status === 'blocked' ? { reason: preCall.reason } : {}),
    ...(preCall.status === 'ready' ? { signals: preCall.signals } : {}) } : { status: 'not_prepared' };
}

function preCallInput() {
  return {
    clientId: 'client-1042', invoiceId: '1042', testIdentityId: 7,
    company: { name: 'Fixture business', website: 'https://example.invalid' },
    context: { client: {
      type: 'business' as const, phoneNumber: '+15555550100', dnc: false, localWeekday: 1, localHour: 10,
      consent: { source: 'judge' as const, text: 'I consent', timestamp: '2026-10-23T18:00:00Z', number: '+15555550100' },
    } },
  };
}

function fixtureDeps(ofacStatus: 'clear' | 'unknown') {
  return {
    credit: fakeCreditCheck({ testIdentityId: 7, ofacStatus, activeSignals: [], evidence: [] }),
    health: fakeHealthCheck({ signals: [] }),
    planner: { draft: async () => ({ output: { tone: 'neutral' as const, offerOrder: ['pay_in_full' as const],
      plan: { installments: 1, firstPaymentPct: 100, totalDays: 0, waiveFees: false, discountPct: 0 } },
      route: 'local' as const, model: 'offline', latencyMs: 0, costUsd: 0 }) },
    audit: new MemoryStateStore(),
    escalate: async () => {},
    now: () => 1_762_000_000_000,
  };
}

async function office(published: ReturnType<typeof publishPreCall>, network: { calls: number }) {
  const counts = { dialCalls: 0, providerRequests: 0 };
  const audits: CallRequestAudit[] = [];
  const dial = createAdminDial({
    bridge: {
      clientStopped: async () => false,
      preCall: async () => parsePreCallGate(published),
      callEvent: async () => undefined,
    },
    dial: async (sessionId, _signals, providerRequest) => {
      counts.dialCalls += 1;
      providerRequest();
      counts.providerRequests += 1;
      return { sessionId, callId: 'offline-stub' };
    },
    audit: async () => undefined,
    sessionStopped: async () => true,
    now: () => 1_762_000_000_000,
    newSessionId: () => 'offline-session',
  });
  const handle = createCallRequestHTTP({
    secret: () => 'operator-code', origin: () => ORIGIN, now: () => 1_762_000_000_000,
    relay: () => RELAY, currentCall: async () => null,
    audit: async entry => { audits.push(entry); },
    fetch: async (input, init) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const headers = new Headers(init?.headers);
      if (url !== RELAY.url || init?.method !== 'POST' || headers.get('authorization') !== `Bearer ${RELAY.secret}`) {
        network.calls += 1;
        throw new Error('EVAL_NETWORK_FORBIDDEN');
      }
      const result = await dial();
      const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      return new Response(body, { status: result.status });
    },
  });
  const post = (action: 'session' | 'request', body: unknown, headers: Record<string, string> = {}) => handle(action, new Request(`${ORIGIN}/api/calls/${action}`, {
    method: 'POST', headers: { origin: ORIGIN, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const session = await post('session', { code: 'operator-code' });
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  if (!cookie?.startsWith('backroom_calls=')) throw new Error('CALL_BUTTON_UNLOCK_FAILED');
  return { counts, audits, click: (body: unknown = { line: 'collections' }) => post('request', body, { cookie }) };
}

export async function runCallButton() {
  const prior = globalThis.fetch;
  const network = { calls: 0 };
  globalThis.fetch = async () => { network.calls += 1; throw new Error('EVAL_NETWORK_FORBIDDEN'); };
  try {
    const blockedPublished = publishPreCall(await runPreCall(preCallInput(), fixtureDeps('unknown')));
    const readyPublished = publishPreCall(await runPreCall(preCallInput(), fixtureDeps('clear')));
    const blockedOffice = await office(blockedPublished, network);
    const blockedResponse = await blockedOffice.click();
    const blockedBody = await blockedResponse.json() as { ok?: boolean; error?: string };
    const blockedAudit = blockedOffice.audits.at(-1);
    const readyOffice = await office(readyPublished, network);
    const invalidResponse = await readyOffice.click(PHONE_BODY);
    const invalidBody = await invalidResponse.json() as { ok?: boolean; error?: string };
    const invalidDialCalls = readyOffice.counts.dialCalls;
    const invalidProviderRequests = readyOffice.counts.providerRequests;
    const readyResponse = await readyOffice.click();
    const readyBody = await readyResponse.json() as { ok?: boolean; error?: string };
    const readyAudit = readyOffice.audits.at(-1);
    const quiet = network.calls === 0;
    const checks = {
      blocked: quiet && blockedBody.error === 'PRECALL_BLOCKED' && blockedAudit?.outcome === 'refused'
        && blockedAudit.code === 'PRECALL_BLOCKED' && blockedAudit.detail === 'Credit/OFAC check unavailable'
        && blockedOffice.counts.dialCalls === 0 && blockedOffice.counts.providerRequests === 0,
      invalid: quiet && invalidBody.error === 'INVALID_REQUEST' && invalidDialCalls === 0 && invalidProviderRequests === 0,
      ready: quiet && readyBody.ok === true && readyOffice.counts.dialCalls === 1 && readyOffice.counts.providerRequests === 1
        && readyAudit?.outcome === 'accepted',
    };
    const passed = Object.values(checks).filter(Boolean).length;
    return {
      match: passed === Object.keys(checks).length, checks, passed, total: Object.keys(checks).length, networkCalls: network.calls,
      blocked: { status: blockedResponse.status, error: blockedBody.error ?? null, audit: blockedAudit ?? null,
        dialCalls: blockedOffice.counts.dialCalls, providerRequests: blockedOffice.counts.providerRequests },
      invalid: { status: invalidResponse.status, error: invalidBody.error ?? null, dialCalls: invalidDialCalls, providerRequests: invalidProviderRequests },
      ready: { status: readyResponse.status, ok: readyBody.ok === true, error: readyBody.error ?? null, audit: readyAudit ?? null,
        dialCalls: readyOffice.counts.dialCalls, providerRequests: readyOffice.counts.providerRequests },
      scope: 'Production runPreCall on fixture credit/health/planner deps (credit ofac unknown blocks as Credit/OFAC check unavailable; clear ofac reaches a local plan). The result is published like services.preCall and read through parsePreCallGate by createAdminDial. createCallRequestHTTP unlocks an operator session and POSTs the collections line; its fetch posts to that admin dial and returns the admin status/body. dial() is a stub that records providerRequest() and performs no HTTP. A body that includes a phone number is rejected before the relay. No CRS, Apify, model, or live dial.',
    };
  } finally { globalThis.fetch = prior; }
}
