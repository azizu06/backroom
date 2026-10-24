/** Server-only loopback proxy, following the handoff proxy's deployment-origin boundary.
 * This is not a login. The gateway secret is attached only to upstream requests.
 */
import { Buffer } from 'node:buffer';
import { parseAttackPresets, parseAttackResult, presetId, record, type AttackMode, type AttackPresets } from './response';

export const ATTACK_DEMO_BASE_URL = 'http://127.0.0.1:8790';
const MAX_BODY = 8192;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const error = (code: string, status: number) => json({ error: code }, status);

/** Never collect more than 8 KB, including for a request with no Content-Length. */
async function readCapped(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}
function parseBody(value: unknown): { text?: string; presetId?: string; mode: AttackMode } | null {
  if (!record(value) || Object.keys(value).some(key => !['text', 'presetId', 'mode'].includes(key))) return null;
  if (value.text !== undefined && (typeof value.text !== 'string' || value.text.length > 2000)) return null;
  if (value.presetId !== undefined && !presetId(value.presetId)) return null;
  if (value.mode !== undefined && value.mode !== 'mock' && value.mode !== 'live') return null;
  const text = typeof value.text === 'string' ? value.text.trim() : '';
  if (!text && !presetId(value.presetId)) return null;
  return { ...(text ? { text } : {}), ...(presetId(value.presetId) ? { presetId: value.presetId } : {}), mode: value.mode ?? 'mock' };
}

export function createAttackDemoProxy(options: {
  origin: () => string | undefined; secret: () => string | undefined; allowLive?: () => boolean;
  baseUrl?: string; transport?: typeof fetch; timeoutMs?: number; now?: () => number;
}) {
  const { baseUrl = ATTACK_DEMO_BASE_URL, transport = fetch, timeoutMs = 30_000, now = Date.now } = options;
  const upstream = `${baseUrl.replace(/\/+$/, '')}/api/attack-demo`;
  let windowStart = now(), posts = 0;
  let cached: { data: AttackPresets; until: number } | undefined;
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'POST') return error('METHOD_NOT_ALLOWED', 405);
    const origin = options.origin();
    // Controller GETs are read-only and browsers omit Origin on same-origin GETs.
    // Reject any explicit foreign Origin; POST always requires an exact match.
    const sentOrigin = request.headers.get('origin');
    if (!origin || (request.method === 'POST' || sentOrigin !== null) && sentOrigin !== origin) return error('ORIGIN_REJECTED', 403);
    const liveBlocked = options.allowLive?.() !== true;
    let body: ReturnType<typeof parseBody> = null;
    if (request.method === 'POST') {
      if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return error('JSON_REQUIRED', 415);
      if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return error('BODY_TOO_LARGE', 413);
      let value: unknown;
      try {
        const raw = await readCapped(request);
        if (raw === null) return error('BODY_TOO_LARGE', 413);
        value = JSON.parse(raw);
      } catch { return error('INVALID_JSON', 400); }
      body = parseBody(value);
      if (!body) return error('INVALID_ATTACK', 400);
      if (liveBlocked) body.mode = 'mock';
    }
    const secret = options.secret();
    if (!secret) return error('ATTACK_NOT_CONFIGURED', 503);
    if (request.method === 'GET' && cached && cached.until > now()) return json({ ...cached.data, liveBlocked: liveBlocked || cached.data.liveBlocked === true });
    if (request.method === 'POST') {
      if (now() - windowStart >= 60_000) { windowStart = now(); posts = 0; }
      if (posts >= 6) return error('ATTACK_RATE_LIMITED', 429);
      posts++;
    }
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await transport(upstream, {
        method: request.method, ...(body ? { body: JSON.stringify(body) } : {}), signal, redirect: 'error', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      });
      // Preserve only the status; never relay an upstream error body (which might contain secrets).
      if (!response.ok) return error('ATTACK_REJECTED', response.status >= 400 && response.status < 600 ? response.status : 502);
      if (response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') return error('ATTACK_BAD_RESPONSE', 502);
      let value: unknown;
      try { value = await response.json(); } catch {
        return error(signal.aborted ? 'ATTACK_TIMEOUT' : 'ATTACK_BAD_RESPONSE', signal.aborted ? 504 : 502);
      }
      if (request.method === 'GET') {
        const data = parseAttackPresets(value);
        if (!data) return error('ATTACK_BAD_RESPONSE', 502);
        cached = { data, until: now() + 60_000 };
        return json({ ...data, liveBlocked: liveBlocked || data.liveBlocked === true });
      }
      const data = parseAttackResult(value);
      return data ? json({ ...data, liveBlocked: liveBlocked || data.liveBlocked === true }) : error('ATTACK_BAD_RESPONSE', 502);
    } catch { return error(signal.aborted ? 'ATTACK_TIMEOUT' : 'ATTACK_UNREACHABLE', signal.aborted ? 504 : 502); }
  };
}
