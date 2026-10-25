import { operatorSignedIn } from '../operator/sign-in';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const UNLOCK = 'Calls are locked. Sign in at /operator with the operator code.';
/** Relay codes the office may show. Anything else is reported generically. */
const RELAY: Record<string, [number, string]> = {
  CLIENT_STOPPED: [409, 'The client asked us to stop. No call placed.'],
  CALL_ACTIVE: [409, 'A call is already on the line.'],
  DIAL_IN_PROGRESS: [409, 'A call is already being placed.'],
  PRECALL_UNAVAILABLE: [503, 'Pre-call status is unavailable. No call placed.'],
  DIAL_FAILED: [502, 'The phone provider rejected the call. Nothing rang.'],
  DIAL_UNCONFIRMED: [504, 'The provider did not confirm the call; the phone may still ring. Not retried.'],
};

/** Seeded email-only clients (fixtures/scenarios/collections.json C14, C12). A key, never a destination. */
export const EMAIL_ONLY_SCENARIOS = ['consumer', 'opt_out'] as const;
export type EmailOnlyScenario = typeof EMAIL_ONLY_SCENARIOS[number];
export type CallRequestAudit = { outcome: 'requested' | 'accepted' | 'refused'; code: string; detail?: string; suppressed?: number; scenario?: EmailOnlyScenario };
export type CallFollowUpResult = { status: 'queued' | 'duplicate' };
export interface CallRequestOptions {
  /** Operator code; its shared sign-in (`/api/session`) unlocks the desk phone. */
  secret: () => string | undefined;
  /** Deployment origin, never derived from Host/X-Forwarded-Host. */
  origin: () => string | undefined;
  /**
   * This host's own office, `http://127.0.0.1:<DEMO_PORT>`. Accepted in addition to
   * `origin`. A public or foreign origin still has to match `origin` exactly.
   */
  loopbackOrigin?: () => string | undefined;
  /** Private loopback voice relay; undefined when voice is not running on this host. */
  relay: () => { url: string; secret: string } | undefined;
  /** The desk phone's current call, from the read-only projection. */
  currentCall: () => Promise<{ status: 'ringing' | 'live' | 'ended'; endedAt?: number } | null>;
  audit: (entry: CallRequestAudit) => Promise<void>;
  /** Trusted demo-host hook. It may queue a simulated preview after a refusal; it never delivers email. */
  followUp?: (entry: CallRequestAudit) => Promise<CallFollowUpResult | undefined>;
  /** Trusted demo-host hook: the production pre-call's email-only DENY rule ids for a seeded client, else undefined. */
  emailOnlyRefusal?: (scenario: EmailOnlyScenario) => Promise<string[] | undefined>;
  fetch?: typeof fetch; now?: () => number;
  /** Minimum gap between dial attempts, and after a call ends. */
  cooldownMs?: number;
}

/**
 * The office button's only path to a phone call. A click by a signed-in operator on the
 * deployment origin, or on this host's own loopback office, is the go for exactly one
 * dial of the relay's server-configured scenario and allowlisted number; the request
 * body cannot name a destination, amount or client.
 */
export function createCallRequestHTTP(options: CallRequestOptions) {
  const now = options.now ?? Date.now, send = options.fetch ?? fetch, cooldownMs = options.cooldownMs ?? 20_000;
  let inFlight = false, lastAttemptAt = -Infinity;
  // Unauthenticated refusals are audited, but at most one row per code every ten seconds.
  const quiet = new Map<string, { at: number; suppressed: number }>();
  // A refusal places nothing, so its audit is best effort; a dial requires its audit first.
  const refuse = async (status: number, code: string, message: string, detail?: string, coalesce = false, scenario?: EmailOnlyScenario) => {
    const entry: CallRequestAudit = { outcome: 'refused', code, ...(detail && { detail }), ...(scenario && { scenario }) };
    if (coalesce) {
      const prior = quiet.get(code);
      if (prior && now() - prior.at < 10_000) { prior.suppressed++; return json({ ok: false, error: code, message }, status); }
      quiet.set(code, { at: now(), suppressed: 0 });
      await options.audit({ ...entry, ...(prior?.suppressed && { suppressed: prior.suppressed }) }).catch(() => undefined);
    } else await options.audit(entry).catch(() => undefined);
    const followedUp = (code === 'PRECALL_BLOCKED' || code === 'CALL_DENIED')
      ? await options.followUp?.(entry).catch(() => undefined) : undefined;
    const suffix = followedUp?.status === 'queued' ? ' Email preview (simulated, not sent).'
      : followedUp?.status === 'duplicate' ? ' Email preview already queued today (simulated, not sent); no second email.' : '';
    return json({ ok: false, error: code, message: `${message}${suffix}`, ...(followedUp && { email: followedUp.status }) }, status);
  };
  const readJSON = async (request: Request, limit: number): Promise<Record<string, unknown> | undefined> => {
    if (!request.headers.get('content-type')?.startsWith('application/json')) return undefined;
    const raw = await request.text();
    if (raw.length > limit) return undefined;
    try { const body: unknown = JSON.parse(raw || '{}'); return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : undefined; }
    catch { return undefined; }
  };
  const matches = (request: Request, candidate: string | undefined) => !!candidate && request.headers.get('origin') === candidate
    && ['same-origin', null].includes(request.headers.get('sec-fetch-site'));
  // Public origin stays an exact match. Loopback is only the host's own office, so the
  // desk phone can dial where its state socket is allowed to connect.
  const acceptedOrigin = (request: Request, origin: string) => matches(request, origin) || matches(request, options.loopbackOrigin?.());

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json({ ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Use POST.' }, 405);
    const secret = options.secret(), origin = options.origin();
    if (!secret || !origin) return refuse(503, 'CALLS_NOT_CONFIGURED', 'Office calls are not configured on this host.', undefined, true);
    if (!acceptedOrigin(request, origin)) return refuse(403, 'ORIGIN_REJECTED', 'Open the office from its public address to place calls.', undefined, true);
    if (!operatorSignedIn(request, secret, now())) return refuse(401, 'OPERATOR_SESSION_REQUIRED', UNLOCK, undefined, true);
    const body = await readJSON(request, 1024);
    // The destination, scenario and amounts are server configuration; reject anything else.
    if (!body || Object.keys(body).some(key => key !== 'line' && key !== 'scenario') || (body.line !== undefined && body.line !== 'collections')
      || (body.scenario !== undefined && !(EMAIL_ONLY_SCENARIOS as readonly unknown[]).includes(body.scenario))) {
      return refuse(400, 'INVALID_REQUEST', 'A call request carries no number or details; only the collections line or a seeded email-only client can be requested.');
    }
    // A seeded email-only client is refused by code before the relay, the call lock or any dial.
    if (body.scenario !== undefined) {
      const scenario = body.scenario as EmailOnlyScenario;
      const rules = await options.emailOnlyRefusal?.(scenario).catch(() => undefined);
      if (!rules?.length) return refuse(503, 'SCENARIO_UNAVAILABLE', 'The email-only demo client is not available on this host. No call placed.', undefined, false, scenario);
      const detail = rules.join(',');
      return refuse(409, 'CALL_DENIED', `Policy refused the call (${detail}). No call placed.`, detail, false, scenario);
    }
    const relay = options.relay();
    if (!relay) return refuse(503, 'VOICE_NOT_RUNNING', 'The voice relay is not running on this host. No call placed.');
    // Take the lock before any await, so two clicks cannot both pass the call-state check.
    if (inFlight) return refuse(409, 'CALL_REQUEST_IN_FLIGHT', 'A call is already being placed.');
    inFlight = true;
    try {
      const current = await options.currentCall();
      if (current && current.status !== 'ended') return refuse(409, 'CALL_ACTIVE', 'A call is already on the line.');
      const wait = Math.max(lastAttemptAt, current?.endedAt ?? -Infinity) + cooldownMs - now();
      if (wait > 0) return refuse(429, 'COOLDOWN', `Line cooling down. Try again in ${Math.ceil(wait / 1000)} s.`);
      try { await options.audit({ outcome: 'requested', code: 'DIAL_REQUESTED' }); }
      catch { return json({ ok: false, error: 'AUDIT_UNAVAILABLE', message: 'The audit record is unavailable. No call placed.' }, 503); }
      lastAttemptAt = now();
      let response: Response;
      try {
        response = await send(relay.url, { method: 'POST', headers: { authorization: `Bearer ${relay.secret}` }, signal: AbortSignal.timeout(30_000) });
      } catch {
        return refuse(504, 'RELAY_UNCONFIRMED', 'The voice relay did not answer; the phone may still ring. Not retried.');
      }
      if (response.ok) {
        await options.audit({ outcome: 'accepted', code: 'DIAL_ACCEPTED' }).catch(() => undefined);
        return json({ ok: true, message: 'Ringing the allowlisted demo phone. Answer on speaker.' });
      }
      const text = (await response.text().catch(() => '')).slice(0, 220);
      if (response.status === 401) return refuse(503, 'VOICE_MISCONFIGURED', 'The voice relay rejected this host. No call placed.');
      const match = /^([A-Z_]{1,40})(?::([\w .,'()/:-]{0,180}))?$/.exec(text);
      const code = match?.[1] ?? '', detail = match?.[2] ?? '';
      if (code === 'PRECALL_BLOCKED') return refuse(409, code, `Pre-call checks blocked this call: ${detail}. No call placed.`, detail);
      if (code === 'PRECALL_NOT_READY') return refuse(409, code, `Pre-call checks are not ready (${detail}). No call placed.`, detail);
      if (code === 'CALL_DENIED') return refuse(409, code, `Policy refused the call (${detail}). No call placed.`, detail);
      const [status, message] = RELAY[code] ?? [502, 'The voice relay refused the call.'];
      return refuse(status, RELAY[code] ? code : 'RELAY_REFUSED', message, RELAY[code] ? undefined : `HTTP ${response.status}`);
    } finally { inFlight = false; }
  };
}
