/** In-app call button: production pre-call, the demo status projection, the dial gate, and the office POST.
 * Fixture credit/health/planner only. dial() counts provider attempts and performs no HTTP. */
import { fakeCreditCheck, fakeHealthCheck, runPreCall, type PreCallInput, type PreCallResult } from '../../collections';
import { MemoryStateStore } from '../../store';
import { createAdminDial, type AdminDialResponse } from '../../voice/admin-dial';
import { parsePreCallGate } from '../../voice/demo-bridge';
import { createCallRequestHTTP, type CallRequestAudit } from '../../../../web/lib/calls/request';

const ORIGIN = 'https://demo.example';
const LOOPBACK = 'http://127.0.0.1:3000';
const RELAY = { url: 'http://127.0.0.1:8788/_admin/dial', secret: 'admin-secret' };
const PHONE_BODY = { line: 'collections', phoneNumber: '+15555550199' };
const BLOCKED_REASON = 'Credit/OFAC check unavailable';

/** The services.preCall object web/lib/demo/services.ts publishes. Blocked keeps reason; ready keeps signals. */
function publishPreCall(preCall: PreCallResult) {
  return {
    status: preCall.status,
    ...(preCall.status === 'blocked' ? { reason: preCall.reason } : {}),
    ...(preCall.status === 'ready' ? { signals: preCall.signals } : {}),
  };
}

function preCallInput(): PreCallInput {
  return {
    clientId: 'client-1042', invoiceId: '1042', testIdentityId: 7,
    company: { name: 'Fixture business', website: 'https://example.invalid' },
    context: { client: {
      type: 'business', phoneNumber: '+15555550100', dnc: false, localWeekday: 1, localHour: 10,
      consent: { source: 'judge', text: 'I consent', timestamp: '2026-10-23T18:00:00Z', number: '+15555550100' },
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

async function office(published: ReturnType<typeof publishPreCall>, network: { calls: number }, options: { requestOrigin?: string; loopbackOrigin?: string } = {}) {
  const home = options.requestOrigin ?? ORIGIN;
  const counts = { providerAttempts: 0, relayCalls: 0 };
  const audits: CallRequestAudit[] = [];
  const adminAudits: { action: string; ruleIds: string[]; reason: string }[] = [];
  const adminResponses: AdminDialResponse[] = [];
  const dial = createAdminDial({
    bridge: {
      clientStopped: async () => false,
      preCall: async () => parsePreCallGate(published),
      callEvent: async () => undefined,
    },
    dial: async sessionId => {
      counts.providerAttempts += 1;
      return { sessionId, callId: 'offline-stub' };
    },
    audit: async entry => { adminAudits.push({ action: entry.action, ruleIds: entry.ruleIds, reason: entry.reason }); },
    sessionStopped: async () => true,
    now: () => 1_762_000_000_000,
    newSessionId: () => 'offline-session',
  });
  const handle = createCallRequestHTTP({
    secret: () => 'operator-code', origin: () => ORIGIN, now: () => 1_762_000_000_000,
    ...(options.loopbackOrigin ? { loopbackOrigin: () => options.loopbackOrigin } : {}),
    relay: () => RELAY, currentCall: async () => null,
    audit: async entry => { audits.push(entry); },
    fetch: async (input, init) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      const headers = new Headers(init?.headers);
      if (url !== RELAY.url || init?.method !== 'POST' || headers.get('authorization') !== `Bearer ${RELAY.secret}` || init.body != null) {
        network.calls += 1;
        throw new Error('EVAL_NETWORK_FORBIDDEN');
      }
      counts.relayCalls += 1;
      const result = await dial();
      adminResponses.push(result);
      const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);
      return new Response(body, { status: result.status });
    },
  });
  const post = (action: 'session' | 'request', body: unknown, headers: Record<string, string> = {}, requestOrigin = home) => handle(action, new Request(`${requestOrigin}/api/calls/${action}`, {
    method: 'POST', headers: { origin: requestOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
  const session = await post('session', { code: 'operator-code' });
  const cookie = session.headers.get('set-cookie')?.split(';')[0];
  if (!cookie?.startsWith('backroom_calls=')) throw new Error('CALL_BUTTON_UNLOCK_FAILED');
  return { counts, audits, adminAudits, adminResponses, click: (body: unknown = { line: 'collections' }) => post('request', body, { cookie }),
    clickFrom: (requestOrigin: string, body: unknown = {}) => post('request', body, { cookie }, requestOrigin) };
}

export async function runCallButton() {
  const prior = globalThis.fetch;
  const network = { calls: 0 };
  globalThis.fetch = async () => { network.calls += 1; throw new Error('EVAL_NETWORK_FORBIDDEN'); };
  try {
    const blockedPre = await runPreCall(preCallInput(), fixtureDeps('unknown'));
    const readyPre = await runPreCall(preCallInput(), fixtureDeps('clear'));
    const blockedPublished = publishPreCall(blockedPre);
    const readyPublished = publishPreCall(readyPre);
    const blockedOffice = await office(blockedPublished, network);
    const blockedResponse = await blockedOffice.click({ line: 'collections' });
    const blockedBody = await blockedResponse.json() as { ok?: boolean; error?: string; message?: string };
    const blockedAudit = blockedOffice.audits.at(-1);
    const blockedAdmin = blockedOffice.adminResponses.at(-1);
    const blockedAdminAudit = blockedOffice.adminAudits.at(-1);
    const readyOffice = await office(readyPublished, network);
    const invalidResponse = await readyOffice.click(PHONE_BODY);
    const invalidBody = await invalidResponse.json() as { ok?: boolean; error?: string };
    const invalidAttempts = readyOffice.counts.providerAttempts;
    const invalidRelayCalls = readyOffice.counts.relayCalls;
    const readyResponse = await readyOffice.click({});
    const readyBody = await readyResponse.json() as { ok?: boolean; error?: string; message?: string };
    const readyAudit = readyOffice.audits.at(-1);
    const secondResponse = await readyOffice.click({});
    const secondBody = await secondResponse.json() as { ok?: boolean; error?: string; message?: string };
    const foreignResponse = await readyOffice.clickFrom('https://evil.example');
    const foreignBody = await foreignResponse.json() as { ok?: boolean; error?: string };
    const loopbackOffice = await office(readyPublished, network, { requestOrigin: LOOPBACK, loopbackOrigin: LOOPBACK });
    const loopbackResponse = await loopbackOffice.click({});
    const loopbackBody = await loopbackResponse.json() as { ok?: boolean; error?: string; message?: string };
    const quiet = network.calls === 0;
    const checks = {
      blocked: quiet && blockedPre.status === 'blocked' && blockedPre.reason === BLOCKED_REASON
        && blockedPublished.status === 'blocked' && blockedPublished.reason === BLOCKED_REASON && !('signals' in blockedPublished)
        && blockedResponse.status === 409 && blockedBody.ok === false && blockedBody.error === 'PRECALL_BLOCKED'
        && blockedBody.message === `Pre-call checks blocked this call: ${BLOCKED_REASON}. No call placed.`
        && blockedAudit?.outcome === 'refused' && blockedAudit.code === 'PRECALL_BLOCKED' && blockedAudit.detail === BLOCKED_REASON
        && blockedOffice.counts.providerAttempts === 0 && blockedOffice.counts.relayCalls === 1
        && blockedAdmin?.status === 409 && blockedAdmin.body === `PRECALL_BLOCKED:${BLOCKED_REASON}`
        && blockedAdminAudit?.action === 'CALL_BLOCKED_PRECALL' && blockedAdminAudit.reason === BLOCKED_REASON && blockedAdminAudit.ruleIds.length === 0,
      invalid: quiet && invalidResponse.status === 400 && invalidBody.ok === false && invalidBody.error === 'INVALID_REQUEST'
        && invalidAttempts === 0 && invalidRelayCalls === 0,
      ready: quiet && readyPre.status === 'ready' && readyPublished.status === 'ready' && 'signals' in readyPublished && !('reason' in readyPublished)
        && readyResponse.status === 200 && readyBody.ok === true
        && readyBody.message === 'Ringing the allowlisted demo phone. Answer on speaker.'
        && readyOffice.counts.providerAttempts === 1 && readyOffice.counts.relayCalls === 1
        && readyAudit?.outcome === 'accepted' && readyAudit.code === 'DIAL_ACCEPTED' && readyOffice.adminAudits.length === 0,
      cooldown: quiet && secondResponse.status === 429 && secondBody.ok === false && secondBody.error === 'COOLDOWN'
        && secondBody.message === 'Line cooling down. Try again in 20 s.'
        && readyOffice.counts.providerAttempts === 1 && readyOffice.counts.relayCalls === 1,
      foreign: quiet && foreignResponse.status === 403 && foreignBody.ok === false && foreignBody.error === 'ORIGIN_REJECTED'
        && readyOffice.counts.providerAttempts === 1 && readyOffice.counts.relayCalls === 1,
      loopback: quiet && loopbackResponse.status === 200 && loopbackBody.ok === true
        && loopbackBody.message === 'Ringing the allowlisted demo phone. Answer on speaker.'
        && loopbackOffice.counts.providerAttempts === 1 && loopbackOffice.counts.relayCalls === 1,
    };
    const passed = Object.values(checks).filter(Boolean).length;
    return {
      match: passed === Object.keys(checks).length, checks, passed, total: Object.keys(checks).length, networkCalls: network.calls,
      blocked: { status: blockedResponse.status, error: blockedBody.error ?? null, providerAttempts: blockedOffice.counts.providerAttempts,
        admin: blockedAdmin ?? null, audit: blockedAudit ?? null, adminAudit: blockedAdminAudit ?? null },
      invalid: { status: invalidResponse.status, error: invalidBody.error ?? null, providerAttempts: invalidAttempts, relayCalls: invalidRelayCalls },
      ready: { status: readyResponse.status, ok: readyBody.ok === true, error: readyBody.error ?? null, audit: readyAudit ?? null,
        providerAttempts: readyOffice.counts.providerAttempts },
      scope: 'Production runPreCall on fixture credit/health/planner deps (credit ofac unknown blocks as Credit/OFAC check unavailable; clear ofac reaches a local plan). The result is published like services.preCall and read through parsePreCallGate by createAdminDial. createCallRequestHTTP unlocks an operator session and POSTs {line:collections} or {}; its fetch returns the admin dial status and text body. dial() counts provider attempts and performs no HTTP. A body that names a phone number is INVALID_REQUEST and never reaches dial. A blocked pre-call is 409 PRECALL_BLOCKED with dial() not called. A ready pre-call invokes dial() once and the button accepts. A second click on that same office is 429 COOLDOWN and does not dial again. The public origin stays an exact match: a foreign Origin is 403 ORIGIN_REJECTED and does not dial again. The host loopback office, when declared, unlocks and dials once. No network and no Cartesia.',
    };
  } finally { globalThis.fetch = prior; }
}
