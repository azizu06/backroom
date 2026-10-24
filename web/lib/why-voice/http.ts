import { askWhy, getStateStore, verifyChain, type StateStore, type WhyAuditEntry } from '@backroom/orchestrator';
import { audioTypes, createCartesia, MAX_AUDIO_BYTES, readBounded, VoiceError } from './cartesia';

interface Options {
  state?: () => StateStore;
  origin?: () => string | undefined;
  apiKey?: () => string | undefined;
  fetch?: typeof fetch;
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Project only recorded policy decisions. ALLOW is permission, never proof of payment. */
export async function loadWhyEntries(state: StateStore): Promise<WhyAuditEntry[]> {
  const rows = await state.listAudit();
  if (!verifyChain(rows).valid) throw new VoiceError('AUDIT_CHAIN_BROKEN', 409);
  return rows.filter(row => row.decision).map(row => ({
    id: row.id, actor: row.actor, seat: row.seat, action: row.action,
    outcome: row.decision === 'ALLOW' ? 'allowed' : row.decision === 'DENY' ? 'denied' : 'escalated',
    ruleIds: row.ruleIds, policyVersion: row.policyVersion, evidenceRefs: row.refs,
    inputs: row.inputs ?? {},
  }));
}

/** Same-origin demo transport, with a server-owned audit snapshot and no state writers.
 * This follows the demo's controller Origin boundary; it is not multi-tenant authentication.
 */
export function createWhyHTTP(options: Options = {}) {
  return async (request: Request, mode: 'text' | 'voice'): Promise<Response> => {
    const start = performance.now();
    if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    const origin = (options.origin ?? (() => process.env.WEBAUTHN_ORIGIN))();
    if (!origin) return json({ error: 'WHY_NOT_CONFIGURED' }, 503);
    if (request.headers.get('origin') !== origin) return json({ error: 'ORIGIN_REJECTED' }, 403);
    try {
      const state = (options.state ?? getStateStore)();
      // Verify before sending audio to a paid service; never consume browser audit rows.
      const entries = await loadWhyEntries(state);
      const apiKey = (options.apiKey ?? (() => process.env.CARTESIA_API_KEY))();
      const cartesia = apiKey ? createCartesia(apiKey, options.fetch) : undefined;
      const generation = state.llmSignal;
      const signal = AbortSignal.any([request.signal, generation, AbortSignal.timeout(45_000)]);
      const limit = mode === 'voice' ? MAX_AUDIO_BYTES + 65536 : 4096;
      if (Number(request.headers.get('content-length')) > limit) throw new VoiceError('BODY_TOO_LARGE', 413);
      const bytes = await readBounded(request.body, limit);
      let question: string;
      if (mode === 'voice') {
        if (!state.llmEnabled || generation.aborted) throw new VoiceError('LLM_OFF', 409);
        if (!cartesia) throw new VoiceError('VOICE_NOT_CONFIGURED', 503);
        const contentType = request.headers.get('content-type') ?? '';
        if (!contentType.startsWith('multipart/form-data;')) throw new VoiceError('AUDIO_FORM_REQUIRED', 415);
        const form = await new Response(Buffer.from(bytes), { headers: { 'Content-Type': contentType } }).formData();
        const clip = form.get('audio');
        if (!(clip instanceof File) || form.getAll('audio').length !== 1 || [...form.keys()].some(key => key !== 'audio') ||
            !clip.size || clip.size > MAX_AUDIO_BYTES) throw new VoiceError('INVALID_CLIP', 400);
        if (!audioTypes.has(clip.type.split(';')[0]!)) throw new VoiceError('UNSUPPORTED_AUDIO', 415);
        question = await cartesia.transcribe(clip, signal);
        if (signal.aborted || !state.llmEnabled) throw new VoiceError('LLM_OFF', 409);
      } else {
        if (!request.headers.get('content-type')?.startsWith('application/json')) throw new VoiceError('JSON_REQUIRED', 415);
        const body = JSON.parse(Buffer.from(bytes).toString('utf8'));
        if (!body || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 1000 ||
            Object.keys(body).join(',') !== 'question') throw new VoiceError('INVALID_QUESTION', 400);
        question = body.question.trim();
      }
      const answer = await askWhy(question, entries, { stateStore: state, fetch: options.fetch });
      let audio = null;
      let audioError: string | null = null;
      if (state.llmEnabled && !generation.aborted && cartesia) {
        try {
          audio = await cartesia.speak(answer.answer, signal);
          if (signal.aborted || !state.llmEnabled) { audio = null; audioError = 'SPEECH_UNAVAILABLE'; }
        } catch { audioError = 'SPEECH_UNAVAILABLE'; }
      } else { audioError = state.llmEnabled ? 'VOICE_NOT_CONFIGURED' : 'LLM_OFF'; }
      return json({ ...answer, question, audio, audioError, latencyMs: Math.round(performance.now() - start) });
    } catch (error) {
      if (error instanceof VoiceError) return json({ error: error.code }, error.status);
      // Provider bodies, audio and transcripts may contain private data. Never log them.
      return json({ error: error instanceof SyntaxError || error instanceof TypeError ? 'INVALID_REQUEST' : 'VOICE_UNAVAILABLE' },
        error instanceof SyntaxError || error instanceof TypeError ? 400 : 503);
    }
  };
}
