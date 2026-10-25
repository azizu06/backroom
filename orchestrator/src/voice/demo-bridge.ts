import type { Context } from '@backroom/policy';

/** The demo host's pre-call result as the live dial sees it. Anything malformed throws (fail closed). */
export type PreCallGate =
  | { status: 'ready'; signals?: NonNullable<Context['signals']> }
  | { status: 'blocked'; reason: string }
  | { status: 'not_ready'; detail: string };
export type VoiceCallEvent = 'started' | 'completed' | 'failed';

const STOP_FLAGS = ['ofacHit', 'closedBusiness', 'bankruptcy', 'disputed'] as const;
function stopSignals(value: unknown): NonNullable<Context['signals']> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEMO_PRECALL_MALFORMED');
  const raw = value as Record<string, unknown>, signals: NonNullable<Context['signals']> = {};
  for (const flag of STOP_FLAGS) {
    if (raw[flag] === undefined) continue;
    if (typeof raw[flag] !== 'boolean') throw new Error('DEMO_PRECALL_MALFORMED');
    signals[flag] = raw[flag];
  }
  if (raw.fraudRiskScore !== undefined) {
    if (typeof raw.fraudRiskScore !== 'number' || !Number.isFinite(raw.fraudRiskScore)) throw new Error('DEMO_PRECALL_MALFORMED');
    signals.fraudRiskScore = raw.fraudRiskScore;
  }
  if (raw.active !== undefined) {
    if (!Array.isArray(raw.active) || !raw.active.every(name => typeof name === 'string' && /^[a-z0-9_]{1,64}$/.test(name))) throw new Error('DEMO_PRECALL_MALFORMED');
    signals.active = raw.active as string[];
  }
  return signals;
}
/** Only `ready` permits a dial. A missing, pending or paused pre-call is never treated as clear. */
export function parsePreCallGate(value: unknown): PreCallGate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('DEMO_PRECALL_MALFORMED');
  const raw = value as Record<string, unknown>;
  if (raw.status === 'ready') {
    const signals = stopSignals(raw.signals);
    return { status: 'ready', ...(signals && { signals }) };
  }
  if (raw.status === 'blocked') {
    const reason = typeof raw.reason === 'string' ? raw.reason.replace(/[^\w .,'()/:-]/g, '').slice(0, 160).trim() : '';
    return { status: 'blocked', reason: reason || 'unspecified' };
  }
  return { status: 'not_ready', detail: typeof raw.status === 'string' && /^[a-z_]{1,32}$/.test(raw.status) ? raw.status : 'unknown' };
}

/** Voice is a client of demo:up's authoritative gateway, never a second payment store. */
export function createDemoVoiceBridge(options: { port: number; controlSecret: string; publicOrigin: string; fetch?: typeof fetch }) {
  const origin = new URL(options.publicOrigin);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password
    || /^(localhost|127\.|\[::1\])/.test(origin.hostname)) throw new Error('PUBLIC_HTTPS_ORIGIN_REQUIRED');
  const send = options.fetch ?? fetch;
  const base = `http://127.0.0.1:${options.port}`;
  const admin = async (path: string, body?: object) => {
    const response = await send(`${base}/__demo/${path}`, { method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${options.controlSecret}`, 'content-type': 'application/json' },
      ...(body && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(1500) });
    if (!response.ok) throw new Error('DEMO_VOICE_STATE_UNAVAILABLE');
    return response.json();
  };
  return {
    register: (sessionId: string) => admin('voice-call', { sessionId }),
    endCall: (sessionId: string) => admin('voice-call-ended', { sessionId }),
    clientStopped: async () => (await admin('voice-client-stopped')).stopped as boolean,
    /** Reads the host's current pre-call result through the same authenticated loopback. */
    preCall: async () => parsePreCallGate((await admin('status'))?.services?.preCall),
    /** Lifecycle for the office desk phone; carries no number, transcript or amount. */
    callEvent: (sessionId: string, event: VoiceCallEvent) => admin('voice-call-event', { sessionId, event }),
    gateway: async (tool: string, request: Request) => {
      const response = await send(`${base}/api/tools/${encodeURIComponent(tool)}`, {
        method: 'POST', headers: request.headers, body: await request.text(), signal: AbortSignal.timeout(1500),
      });
      if (!response.ok || tool !== 'send_payment_link') return response;
      const result = await response.json();
      if (result.kind === 'RECORDED' && /^[A-F0-9]{10}$/.test(result.short_code)) {
        const code = result.short_code as string;
        result.payment_url = `${origin.origin}/p/${code}`;
        result.speak = `Your payment page is ready. Scan the QR code on the office screen, or visit ${origin.host}, slash p, slash ${code.split('').join(' ')}. The code expires in fifteen minutes. No text message was sent.`;
      }
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    },
  };
}
export type DemoVoiceBridge = ReturnType<typeof createDemoVoiceBridge>;
