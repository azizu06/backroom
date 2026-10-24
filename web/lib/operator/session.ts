import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'backroom_operator', SESSION_MS = 8 * 60 * 60 * 1000;
type OperatorEnv = Record<string, string | undefined>;
export function equalSecret(left: string, right: string) {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function sign(expires: string, env: OperatorEnv) {
  return createHmac('sha256', env.DEMO_CONTROL_SECRET!).update(`operator:${expires}`).digest('hex');
}
export function operatorSession(env: OperatorEnv, origin: string, now = Date.now()) {
  if (!env.DEMO_CONTROL_SECRET) throw new Error('OPERATOR_NOT_CONFIGURED');
  const expires = String(now + SESSION_MS);
  return `${COOKIE}=${expires}.${sign(expires, env)}; Path=/api/operator; HttpOnly; SameSite=Strict${origin.startsWith('https:') ? '; Secure' : ''}; Max-Age=${SESSION_MS / 1000}`;
}
export function operatorSessionValid(request: Request, env: OperatorEnv, now = Date.now()) {
  if (!env.DEMO_CONTROL_SECRET) return false;
  const token = request.headers.get('cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  const [expires = '', signature = '', extra] = token?.split('.') ?? [];
  return extra === undefined && /^\d+$/.test(expires) && Number(expires) > now && Number(expires) <= now + SESSION_MS
    && equalSecret(signature, sign(expires, env));
}
/** Host is compared with a server-configured allowlist; forwarded headers confer no authority. */
export function operatorOriginAllowed(request: Request, env: OperatorEnv) {
  const allowed = [`http://127.0.0.1:${env.DEMO_PORT || 3000}`, env.DEMO_PUBLIC_URL].filter((value): value is string => !!value);
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') || new URL(request.url).host;
  return allowed.some(value => {
    try { return new URL(value).host === host && (request.method === 'GET' && origin === null || origin === value); }
    catch { return false; }
  }) && request.headers.get('sec-fetch-site') !== 'cross-site';
}
/** A tunnel also arrives on loopback, so both socket AND exact private Host are mandatory. */
export function localOperatorRequest(address: string | undefined, host: string | undefined, origin: string | undefined, port: number) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address || '') && host === `127.0.0.1:${port}`
    && origin === `http://127.0.0.1:${port}`;
}
