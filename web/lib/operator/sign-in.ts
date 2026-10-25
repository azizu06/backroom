import { createHmac, timingSafeEqual } from 'node:crypto';
import { declaredLoopbackOfficeOrigin } from '../calls/loopback-origin';

/**
 * One operator sign-in for the whole demo origin. The operator code
 * (`CONTROLLER_ENROLLMENT_SECRET`) opens one HttpOnly session that the operator console,
 * desk-phone calls, audit wall and policy editor each verify themselves. It never
 * authorizes an approval or a payment: those stay with Dana's passkey.
 */
export const OPERATOR_SESSION_COOKIE = 'backroom_session';
export const OPERATOR_SESSION_MS = 8 * 60 * 60 * 1000;
const MAX_FAILURES = 5, LOCKOUT_MS = 60_000, MAX_TRACKED_CLIENTS = 1000;
type Env = Record<string, string | undefined>;

const equal = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const sign = (code: string, expires: string) => createHmac('sha256', code).update(`operator-session:${expires}`).digest('hex');

/** Server-configured origins only; Host and forwarded headers confer nothing. */
export function hostOrigins(env: Env) {
  return [...new Set([env.WEBAUTHN_ORIGIN, env.DEMO_PUBLIC_URL, declaredLoopbackOfficeOrigin(env.DEMO_PORT)].filter((value): value is string => !!value))];
}

export function operatorSessionCookie(code: string, origin: string, now = Date.now()) {
  const expires = String(now + OPERATOR_SESSION_MS);
  return `${OPERATOR_SESSION_COOKIE}=${expires}.${sign(code, expires)}; Path=/; HttpOnly; SameSite=Strict${origin.startsWith('https:') ? '; Secure' : ''}; Max-Age=${OPERATOR_SESSION_MS / 1000}`;
}

/** Code-free loopback bootstrap uses the same cookie as typed operator sign-in. */
export function localOperatorSessionCookie(env: Env, origin: string, now = Date.now()) {
  const code = env.CONTROLLER_ENROLLMENT_SECRET;
  if (!code) throw new Error('OPERATOR_NOT_CONFIGURED');
  return operatorSessionCookie(code, origin, now);
}
export const OPERATOR_SIGN_OUT_COOKIE = `${OPERATOR_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;

/** Cookie check only. Each surface still applies its own origin rule before trusting it. */
export function operatorSignedIn(request: Request, code: string | undefined, now = Date.now()) {
  if (!code) return false;
  const token = request.headers.get('cookie')?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${OPERATOR_SESSION_COOKIE}=`))?.slice(OPERATOR_SESSION_COOKIE.length + 1);
  const [expires = '', signature = '', extra] = token?.split('.') ?? [];
  return extra === undefined && /^\d+$/.test(expires) && Number(expires) > now && Number(expires) <= now + OPERATOR_SESSION_MS
    && equal(signature, sign(code, expires));
}

export type SignInError = 'NOT_CONFIGURED' | 'ORIGIN_REJECTED' | 'INVALID_REQUEST' | 'OPERATOR_CODE_REJECTED' | 'RATE_LIMITED';
export type SignInResult = { ok: true; cookie: string } | { ok: false; status: number; error: SignInError };

/**
 * Checks the operator code from an allowed origin. Five wrong codes from one client lock
 * that client out for a minute, correct code or not. Behind the public tunnel the client
 * is Cloudflare's `cf-connecting-ip`; requests without it share one bucket.
 */
export function createOperatorSignIn(options: { code: () => string | undefined; origins: () => string[]; now?: () => number }) {
  const now = options.now ?? Date.now;
  const failures = new Map<string, { count: number; lockedUntil: number }>();
  return async (request: Request): Promise<SignInResult> => {
    const code = options.code(), origin = request.headers.get('origin');
    if (!code) return { ok: false, status: 503, error: 'NOT_CONFIGURED' };
    if (request.method !== 'POST' || !origin || !options.origins().includes(origin)
      || !['same-origin', null].includes(request.headers.get('sec-fetch-site'))) return { ok: false, status: 403, error: 'ORIGIN_REJECTED' };
    const client = request.headers.get('cf-connecting-ip')?.trim() || 'direct';
    const record = failures.get(client);
    if (record && record.lockedUntil > now()) return { ok: false, status: 429, error: 'RATE_LIMITED' };
    if (record && record.lockedUntil) failures.delete(client);
    let body: unknown;
    try {
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error();
      const raw = await request.text();
      if (raw.length > 4096) throw new Error();
      body = JSON.parse(raw);
    } catch { return { ok: false, status: 400, error: 'INVALID_REQUEST' }; }
    const attempt = body && typeof body === 'object' && 'code' in body ? body.code : undefined;
    if (typeof attempt !== 'string' || !equal(attempt, code)) {
      const next = { count: (failures.get(client)?.count ?? 0) + 1, lockedUntil: 0 };
      if (next.count >= MAX_FAILURES) next.lockedUntil = now() + LOCKOUT_MS;
      failures.delete(client); failures.set(client, next);
      if (failures.size > MAX_TRACKED_CLIENTS) failures.delete(failures.keys().next().value!);
      return { ok: false, status: 403, error: 'OPERATOR_CODE_REJECTED' };
    }
    failures.delete(client);
    return { ok: true, cookie: operatorSessionCookie(code, origin, now()) };
  };
}

const MESSAGES: Record<SignInError, string> = {
  NOT_CONFIGURED: 'Operator sign-in is not configured on this host.',
  ORIGIN_REJECTED: 'Origin rejected.',
  INVALID_REQUEST: 'Enter the operator code.',
  OPERATOR_CODE_REJECTED: 'Operator code rejected.',
  RATE_LIMITED: 'Too many wrong codes. Wait one minute, then try again.',
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

/** `/api/session`: POST signs in, GET reports the session, DELETE signs out. */
export function createSignInHTTP(options: {
  signIn: (request: Request) => Promise<SignInResult>; signedIn: (request: Request) => boolean; origins: () => string[];
}) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'POST') {
      const result = await options.signIn(request);
      return result.ok ? json({ ok: true, message: 'Signed in on this browser for eight hours.' }, 200, { 'Set-Cookie': result.cookie })
        : json({ ok: false, error: result.error, message: MESSAGES[result.error] }, result.status);
    }
    const origin = request.headers.get('origin');
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin !== null && !options.origins().includes(origin))) {
      return json({ ok: false, error: 'ORIGIN_REJECTED', message: MESSAGES.ORIGIN_REJECTED }, 403);
    }
    if (request.method === 'GET') return json({ signedIn: options.signedIn(request) });
    if (request.method === 'DELETE' && origin !== null) return json({ signedIn: false }, 200, { 'Set-Cookie': OPERATOR_SIGN_OUT_COOKIE });
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Use GET, POST or DELETE.' }, 405);
  };
}

// One limiter per server process, shared by every route bundle.
const root = globalThis as typeof globalThis & { backroomOperatorSignIn?: ReturnType<typeof createOperatorSignIn> };
export const hostSignIn = (request: Request) => (root.backroomOperatorSignIn ??= createOperatorSignIn({
  code: () => process.env.CONTROLLER_ENROLLMENT_SECRET, origins: () => hostOrigins(process.env),
}))(request);
export const hostSignedIn = (request: Request) => operatorSignedIn(request, process.env.CONTROLLER_ENROLLMENT_SECRET);
