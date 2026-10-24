/**
 * Server-only proxy for handoff voices: validates the line, then forwards it to the local voice server
 * (`pnpm --filter @backroom/orchestrator handoff:serve`) with the gateway secret, which never reaches the browser.
 * Guard: same deployment origin as the controller routes (WEBAUTHN_ORIGIN), JSON only, small bodies,
 * exactly {role, text}, allow-listed roles and the voice server's text rules.
 */
import { isHandoffRole, validLineText } from './handoff-voice';

export const HANDOFF_UPSTREAM = 'http://127.0.0.1:8789/api/handoff';
const MAX_BODY = 4096;

function json(error: string, status: number) {
  return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function createHandoffProxy(options: {
  origin: () => string | undefined;
  secret: () => string | undefined;
  upstream?: string;
  transport?: typeof fetch;
  timeoutMs?: number;
}) {
  const { upstream = HANDOFF_UPSTREAM, transport = fetch, timeoutMs = 15_000 } = options;
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return json('METHOD_NOT_ALLOWED', 405);
    const origin = options.origin();
    if (!origin || request.headers.get('origin') !== origin) return json('ORIGIN_REJECTED', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) return json('JSON_REQUIRED', 415);
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return json('BODY_TOO_LARGE', 413);
    let body: unknown;
    try {
      const raw = await request.text();
      if (Buffer.byteLength(raw) > MAX_BODY) return json('BODY_TOO_LARGE', 413);
      body = JSON.parse(raw);
    } catch { return json('INVALID_JSON', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'role,text') return json('INVALID_HANDOFF', 400);
    const { role, text } = body as Record<string, unknown>;
    if (!isHandoffRole(role) || !validLineText(text)) return json('INVALID_HANDOFF', 400);
    const secret = options.secret();
    if (!secret) return json('VOICE_NOT_CONFIGURED', 503);
    let response: Response;
    try {
      response = await transport(upstream, {
        method: 'POST', body: JSON.stringify({ role, text }), signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      });
    } catch { return json('VOICE_UNREACHABLE', 502); }
    if (!response.ok) {
      // Keep the upstream status (401/413/429/503…) but never relay its body.
      return json('VOICE_REJECTED', response.status >= 400 && response.status < 600 ? response.status : 502);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('audio/')) return json('VOICE_BAD_RESPONSE', 502);
    return new Response(response.body, { headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' } });
  };
}
