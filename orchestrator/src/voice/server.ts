import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { identityReply, type VoiceSession } from './index';
import { voiceTools } from './tools';

interface JournalData { sessions: VoiceSession[]; events: { id: string; type: string; callId: string; at: string }[] }
/** One local process, atomic file replacement. Inject a transactional DB adapter
 * before multi-instance deployment. Never share this file between processes. */
export class VoiceJournal {
  private data: JournalData;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private file?: string) {
    this.data = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as JournalData : { sessions: [], events: [] };
  }
  transact<T>(work: (data: JournalData) => Promise<T> | T): Promise<T> {
    const run = this.tail.then(async () => {
      const next = structuredClone(this.data), result = await work(next);
      if (this.file) {
        mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
        writeFileSync(`${this.file}.tmp`, JSON.stringify(next), { mode: 0o600 });
        renameSync(`${this.file}.tmp`, this.file);
      }
      this.data = next;
      return result;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
  register(session: VoiceSession) { return this.transact(data => {
    if (data.sessions.some(s => s.id === session.id)) throw new Error('SESSION_EXISTS');
    data.sessions.push(structuredClone(session));
  }); }
  bind(sessionId: string, callId: string) { return this.transact(data => {
    const s = data.sessions.find(s => s.id === sessionId);
    if (!s || (s.providerCallId && s.providerCallId !== callId) || data.sessions.some(other => other.id !== sessionId && other.providerCallId === callId)) throw new Error('INVALID_CALL_BINDING');
    s.providerCallId = callId;
  }); }
}
class HTTPError extends Error { constructor(readonly status: number, code: string) { super(code); } }
const equal = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const safeStops = ['record_opt_out', 'request_human', 'mark_dispute', 'report_already_paid'];

export function createVoiceHandler(options: { journal: VoiceJournal; eventSecret: string; toolSecret: string; gatewaySecret: string;
  gateway: (tool: string, request: Request) => Promise<Response>; agentId?: string }) {
  if (![options.eventSecret, options.toolSecret, options.gatewaySecret].every(s => s.length > 0)) throw new Error('VOICE_SECRETS_REQUIRED');
  const forward = async (tool: string, body: Record<string, unknown>) => {
    const r = await options.gateway(tool, new Request(`https://gateway.internal/api/tools/${tool}`, {
      method: 'POST', headers: { authorization: `Bearer ${options.gatewaySecret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    if (!r.ok) throw new HTTPError(r.status, 'GATEWAY_REJECTED');
    return await r.json() as Record<string, unknown>;
  };
  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const event = path === '/api/voice/cartesia', tool = path.startsWith('/api/voice/tools/') ? path.slice('/api/voice/tools/'.length) : '';
    if (!event && !Object.hasOwn(voiceTools, tool)) return response({ error: 'UNKNOWN_ROUTE' }, 404);
    if (request.method !== 'POST') return response({ error: 'METHOD' }, 405);
    const actual = request.headers.get(event ? 'x-webhook-secret' : 'authorization') ?? '';
    const expected = event ? options.eventSecret : `Bearer ${options.toolSecret}`;
    if (!equal(actual, expected)) return response({ error: 'UNAUTHORIZED' }, 401);
    try {
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 65_536) throw new HTTPError(413, 'TOO_LARGE');
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw) as Record<string, unknown>; } catch { throw new HTTPError(400, 'INVALID_JSON'); }
      if (!body || Array.isArray(body) || typeof body.call_id !== 'string' || typeof body.webhook_request_id !== 'string'
        || !/^[A-Za-z0-9_.:-]{1,200}$/.test(body.call_id) || !/^[A-Za-z0-9_.:-]{1,200}$/.test(body.webhook_request_id)) throw new HTTPError(400, 'INVALID_ENVELOPE');
      return await options.journal.transact(async data => {
        if (event) {
          // https://docs.cartesia.ai/line/infrastructure/observability#webhooks
          // Event IDs stay stable across retries. Commit event and state together.
          if (options.agentId && body.agent_id !== options.agentId) throw new HTTPError(403, 'WRONG_AGENT');
          if (!['call_started', 'call_completed', 'call_failed', 'call_turn', 'post_call_analysis'].includes(String(body.type))) throw new HTTPError(400, 'INVALID_EVENT');
          const existing = data.events.find(e => e.id === body.webhook_request_id);
          if (existing) {
            if (existing.callId !== body.call_id || existing.type !== body.type) throw new HTTPError(409, 'EVENT_ID_REUSED');
            return response({ duplicate: true });
          }
          const session = data.sessions.find(s => s.providerCallId === body.call_id);
          if (!session) throw new HTTPError(503, 'CALL_BINDING_PENDING'); // Retried after dial response binds ID.
          if (body.type === 'call_turn') {
            const turn = body.turn as { role?: string; text?: string; was_interrupted?: boolean; tool_calls?: unknown[] } | undefined;
            // Cartesia omits text on assistant turns that contain only tool calls.
            // Acknowledge these lifecycle receipts without treating tool claims as speech.
            const toolOnly = turn?.role === 'assistant' && turn.text === undefined && Array.isArray(turn.tool_calls) && turn.tool_calls.length > 0;
            if (!turn || (typeof turn.text !== 'string' && !toolOnly)) throw new HTTPError(400, 'INVALID_TURN');
            const text = turn.text ?? '';
            if (turn.role === 'assistant' && turn.was_interrupted === false && normalize(text).startsWith(normalize(session.welcome)) && !session.disclosureComplete) {
              session.disclosureComplete = true; session.userReply = ''; // Earlier background speech is not an answer to this question.
            }
            if (turn.role === 'user') {
              session.userReply = session.disclosureComplete && turn.was_interrupted === false ? text.slice(0, 1000).replace(/\+?\d[\d ()-]{7,}\d/g, '[number]') : '';
              const optOut = /\b(stop (calling|contacting|collection)|dont call|don't call|do not (call|contact)|never call|remove my number|take me off|opt out)\b/i.test(text);
              if (optOut || /\b(bankrupt(cy)?|chapter (7|11|13))\b/i.test(text)) {
                session.stopped = true;
                await forward(optOut ? 'record_opt_out' : 'request_human', { call_id: session.id, webhook_request_id: body.webhook_request_id });
              }
            }
          }
          if (body.type === 'call_completed' || body.type === 'call_failed') session.stopped = true;
          data.events.push({ id: body.webhook_request_id as string, type: String(body.type), callId: body.call_id as string, at: new Date().toISOString() });
          return response({ ok: true });
        }
        const session = data.sessions.find(s => s.id === body.call_id);
        if (!session) throw new HTTPError(404, 'SESSION_NOT_FOUND');
        const nonce = body.webhook_request_id as string;
        const fingerprint = createHash('sha256').update(JSON.stringify([tool, Object.entries(body).sort(([a], [b]) => a.localeCompare(b))])).digest('hex');
        const existing = Object.hasOwn(session.deliveries, nonce) ? session.deliveries[nonce] : undefined;
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new HTTPError(409, 'NONCE_REUSED');
          return response({ duplicate: true, can_confirm: false, next_delivery_nonce: session.nonce });
        }
        if (nonce !== session.nonce) throw new HTTPError(409, 'INVALID_NONCE');
        let result: Record<string, unknown>;
        if (!safeStops.includes(tool) && (!session.disclosureComplete || session.stopped)) result = {
          kind: 'DENY', can_confirm: false, rule_ids: [session.stopped ? 'CALL_STOPPED' : 'DISCLOSURE_REQUIRED'],
          speak: session.stopped ? 'Collection is paused. A human will follow up.' : `Repeat this complete disclosure first: ${session.welcome}`,
        };
        else {
          const payload = { ...body };
          if (tool === 'verify_identity_result') payload.result = identityReply(session.userReply, session.contactName);
          result = await forward(tool, payload);
          if (safeStops.includes(tool) || payload.result === 'wrong_person') session.stopped = true;
        }
        const next = randomUUID();
        session.deliveries[nonce] = { fingerprint, next }; session.nonce = next;
        return response({ ...result, next_delivery_nonce: next });
      });
    } catch (error) {
      return response({ error: error instanceof HTTPError ? error.message : 'VOICE_ERROR', can_confirm: false }, error instanceof HTTPError ? error.status : 500);
    }
  };
}
