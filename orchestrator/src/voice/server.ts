import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { identityFromAnswer, type InterpretAnswer } from './answer';
import type { VoiceSession } from './index';
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
  /** Serialized read of committed state; never writes. */
  read<T>(view: (data: JournalData) => T): Promise<T> {
    return this.tail.then(() => view(structuredClone(this.data)));
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
/** Welcome with one leading hi/hello/hey removed. The rest must occur in full, in order. */
const disclosureCore = (welcome: string) => normalize(welcome).replace(/^(?:hello|hey|hi)/, '');
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const safeStops = ['record_opt_out', 'request_human', 'mark_dispute', 'report_already_paid'];
/** First unclear answer gets one rephrased re-ask; the second ends with a callback offer. */
const MAX_IDENTITY_FAILURES = 2;
/** The same refused request this many times in a row is a loop, not progress. */
const MAX_REPEATED_DENIALS = 3;
const OPT_OUT = /\b(stop (calling|contacting|texting)( me)?|stop (the )?collection|(dont|don't|do not) (ever )?(call|contact)|never (call|contact)|no more calls|remove (me|my number)|take me off|unsubscribe|leave me alone|lose (this|my) number|opt(-| )?out)\b/i;
const BANKRUPTCY = /\b(bankrupt(cy)?|chapter (7|11|13))\b/i;
const HUMAN = /\b(speak|talk|transfer me|put me through|connect me)\b.{0,16}\b((a|an) (real |actual |live )?(human|person|representative)|(your|a|the) (manager|supervisor)|dana)\b/i;
/** Caller words that stop collection in code, whatever the model does. Stops only ever end negotiation. */
export function callerStop(text: string): 'record_opt_out' | 'request_human' | undefined {
  if (OPT_OUT.test(text)) return 'record_opt_out';
  if (BANKRUPTCY.test(text) || HUMAN.test(text)) return 'request_human';
  return undefined;
}

export function createVoiceHandler(options: { journal: VoiceJournal; eventSecret: string; toolSecret: string; gatewaySecret: string;
  gateway: (tool: string, request: Request) => Promise<Response>; agentId?: string;
  /** Optional language-only reading of the caller's answer; code still decides identity. */
  interpretAnswer?: InterpretAnswer;
  /** Longest wait for a caller turn that has not arrived yet when identity is checked. */
  answerWaitMs?: number;
  /** Gateway call id (voice session id), not the provider call id. Closes that call's open approvals. */
  onCallEnded?: (gatewayCallId: string) => Promise<void> }) {
  if (![options.eventSecret, options.toolSecret, options.gatewaySecret].every(s => s.length > 0)) throw new Error('VOICE_SECRETS_REQUIRED');
  const forward = async (tool: string, body: Record<string, unknown>) => {
    const r = await options.gateway(tool, new Request(`https://gateway.internal/api/tools/${tool}`, {
      method: 'POST', headers: { authorization: `Bearer ${options.gatewaySecret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    if (!r.ok) throw new HTTPError(r.status, 'GATEWAY_REJECTED');
    return await r.json() as Record<string, unknown>;
  };
  const wait = options.answerWaitMs ?? 1200;
  /** Runs outside the journal lock so a slow model never blocks call events. Any failure leaves code's reading. */
  const interpretIdentity = async (sessionId: string) => {
    const read = () => options.journal.read(data => data.sessions.find(s => s.id === sessionId));
    let session = await read();
    // The caller's turn event can land just after the tool request; give it a moment instead of judging silence.
    for (let waited = 0; session?.identity && !session.stopped && session.identity.turns <= session.identity.countedAt && waited < wait; waited += 100) {
      await new Promise(resolve => setTimeout(resolve, 100));
      session = await read();
    }
    const identity = session?.identity;
    if (!options.interpretAnswer || !identity || session?.stopped || identity.replies.length === 0) return undefined;
    try {
      return { replies: JSON.stringify(identity.replies), answer: await options.interpretAnswer({ question: identity.question, replies: identity.replies }) };
    } catch { return undefined; }
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
      const interpreted = tool === 'verify_identity_result' ? await interpretIdentity(body.call_id) : undefined;
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
            const turn = body.turn as { role?: string; text?: string | null; was_interrupted?: boolean; tool_calls?: unknown[] } | undefined;
            // Cartesia omits text on assistant turns that contain only tool calls.
            // Acknowledge these lifecycle receipts without treating tool claims as speech.
            const toolOnly = turn?.role === 'assistant' && (turn.text === undefined || turn.text === null) && Array.isArray(turn.tool_calls) && turn.tool_calls.length > 0;
            if (!turn || (typeof turn.text !== 'string' && !toolOnly)) throw new HTTPError(400, 'INVALID_TURN');
            const text = turn.text ?? '';
            const core = disclosureCore(session.welcome);
            if (turn.role === 'assistant' && turn.was_interrupted === false && core.length > 0 && normalize(text).includes(core) && !session.disclosureComplete) {
              // Earlier background speech is not an answer to this question.
              session.disclosureComplete = true; session.identity = { question: text, replies: [], turns: 0, failures: 0, countedAt: 0 };
            } else if (turn.role === 'assistant' && session.identity && text.includes('?') && normalize(text).includes(normalize(session.contactName))) {
              // A re-ask opens a new answer window, so stale chatter cannot answer it.
              session.identity.question = text; session.identity.replies = [];
            }
            if (turn.role === 'user') {
              // Barge-in and short answers still count: keep every non-empty caller turn after disclosure.
              if (session.identity && normalize(text)) {
                session.identity.replies = [...session.identity.replies, text.slice(0, 1000).replace(/\+?\d[\d ()-]{7,}\d/g, '[number]')].slice(-4);
                session.identity.turns += 1;
              }
              const stop = callerStop(text);
              if (stop) {
                session.stopped = true;
                await forward(stop, { call_id: session.id, webhook_request_id: body.webhook_request_id });
              }
            }
          }
          if (body.type === 'call_completed' || body.type === 'call_failed') {
            session.stopped = true;
            await options.onCallEnded?.(session.id);
          }
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
          const payload = { ...body }, identity = session.identity;
          if (tool === 'verify_identity_result') {
            // Use the model's reading only if no caller turn arrived while it was interpreting.
            const answer = interpreted && identity && JSON.stringify(identity.replies) === interpreted.replies ? interpreted.answer : undefined;
            payload.result = identityFromAnswer(answer, identity?.replies ?? [], session.contactName);
          }
          result = await forward(tool, payload);
          if (safeStops.includes(tool) || payload.result === 'wrong_person') session.stopped = true;
          if (tool === 'verify_identity_result') {
            result = { ...result, identity: payload.result };
            if (payload.result === 'uncertain' && identity) {
              // Only an answer heard since the last count is a failure; a repeated check is not.
              if (identity.turns > identity.countedAt) { identity.failures += 1; identity.countedAt = identity.turns; }
              if (identity.failures >= MAX_IDENTITY_FAILURES) {
                session.stopped = true;
                result = { ...result, can_confirm: false, next_step: 'offer_callback_and_end',
                  speak: `I'm sorry, I couldn't confirm I'm speaking with ${session.contactName}, so I can't go over the account on this call. Please call us back when it's convenient.` };
              } else result = { ...result, next_step: 'ask_again_once' };
            }
          }
        }
        if (!safeStops.includes(tool)) {
          // A model stuck re-sending the same refused request ends the call politely instead of looping.
          const key = JSON.stringify([tool, Object.entries(body).filter(([k]) => k !== 'call_id' && k !== 'webhook_request_id').sort(([a], [b]) => a.localeCompare(b))]);
          session.loop = result.kind !== 'DENY' ? undefined : { key, repeats: session.loop?.key === key ? session.loop.repeats + 1 : 1 };
          if (session.loop && session.loop.repeats >= MAX_REPEATED_DENIALS) {
            session.stopped = true;
            result = { ...result, can_confirm: false, next_step: 'offer_callback_and_end',
              speak: "I'm sorry, I'm not able to sort this out on this call. Please call us back and we'll help you then." };
          }
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
