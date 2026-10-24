import { timingSafeEqual } from 'node:crypto';
import type { PolicyLimits, StateStore } from '@backroom/orchestrator';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const equal = (actual: string, expected: string) => {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
/** Explicit rehearsal fallback. Separate from voice/tool credentials; no agent tool routes here. */
export function createPolicyHTTP(config: {
  store: () => StateStore; pin: () => string | undefined; origin: () => string | undefined; now?: () => number;
  /** The shared operator sign-in; an alternative to the PIN, never an approval. */
  signedIn?: (request: Request) => boolean;
}) {
  const now = config.now ?? Date.now;
  let failures = 0, retryAfter = 0;
  return async (request: Request) => {
    const pin = config.pin(), origin = config.origin();
    if (!pin || pin.length < 8 || !origin) return json({ error: 'POLICY_EDITOR_NOT_CONFIGURED' }, 503);
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    // All requests use a non-simple header; only same-origin browsers can send it.
    if (request.headers.get('sec-fetch-site') === 'cross-site'
      || (request.method === 'POST' && request.headers.get('origin') !== origin)) return json({ error: 'ORIGIN_REJECTED' }, 403);
    const authMethod = config.signedIn?.(request) ? 'operator_session' : 'demo_pin';
    if (authMethod === 'demo_pin') {
      if (retryAfter && now() >= retryAfter) { failures = 0; retryAfter = 0; }
      if (failures >= 5) return json({ error: 'PIN_RATE_LIMITED' }, 429);
      const sent = request.headers.get('x-policy-demo-pin');
      // A signed-out page probes without a PIN; that is not a wrong guess.
      if (sent === null) return json({ error: 'OWNER_PIN_REQUIRED' }, 401);
      if (!equal(sent, pin)) {
        if (++failures >= 5) retryAfter = now() + 60_000;
        return json({ error: 'OWNER_PIN_REQUIRED' }, 401);
      }
    }
    try {
      const store = config.store();
      if (request.method === 'GET') return json({ policy: await store.getPolicy(), authMethod });
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'JSON_REQUIRED' }, 415);
      const raw = await request.text();
      if (raw.length > 4096) return json({ error: 'REQUEST_TOO_LARGE' }, 413);
      const body = JSON.parse(raw);
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).sort().join(',') !== 'expectedVersion,limits'
        || !Number.isSafeInteger(body.expectedVersion)) return json({ error: 'INVALID_REQUEST' }, 400);
      const policy = await store.savePolicyLimits(body.expectedVersion, body.limits as PolicyLimits, now(), authMethod);
      return json({ policy, authMethod });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'POLICY_CONFLICT') return json({ error: message }, 409);
      if (message === 'INVALID_LIMITS' || error instanceof SyntaxError) return json({ error: 'INVALID_LIMITS' }, 400);
      return json({ error: 'POLICY_UNAVAILABLE' }, 503);
    }
  };
}
