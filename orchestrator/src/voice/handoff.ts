import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HANDOFF_MODEL, voices, type HandoffRole } from './voices';

class HandoffError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
/** Instantiate once at server startup. Cache hits consume no budget or network.
 * Reserve characters before fetch, including ambiguous failures; no automatic retries. */
export function createHandoffHandler(options: {
  cacheDir?: string; characterBudget?: number; apiKey?: () => string | undefined;
  secret?: () => string | undefined; http?: typeof fetch;
} = {}) {
  const cacheDir = options.cacheDir ?? '.env.voice/handoff-cache';
  const budget = options.characterBudget ?? Number(process.env.CARTESIA_TTS_CHARACTER_BUDGET ?? 20_000);
  if (!Number.isSafeInteger(budget) || budget < 0) throw Error('INVALID_TTS_BUDGET');
  let characters = 0;
  const pending = new Map<string, Promise<Uint8Array>>();
  async function synthesize(text: string, role: HandoffRole, key: string): Promise<Uint8Array> {
    const path = join(cacheDir, `${key}.wav`);
    try { return await readFile(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const apiKey = (options.apiKey ?? (() => process.env.CARTESIA_API_KEY))();
    if (!apiKey) throw new HandoffError(503, 'TTS_NOT_CONFIGURED');
    const count = Array.from(text).length;
    if (characters + count > budget) throw new HandoffError(429, 'TTS_CHARACTER_BUDGET');
    characters += count;
    const response = await (options.http ?? fetch)('https://api.cartesia.ai/tts/bytes', {
      method: 'POST', headers: { 'X-API-Key': apiKey, 'Cartesia-Version': '2026-08-14', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: HANDOFF_MODEL, transcript: text, language: 'en',
        voice: { mode: 'id', id: voices[role].id },
        output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 24000 } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new HandoffError(502, 'TTS_PROVIDER_UNAVAILABLE');
    const audio = new Uint8Array(await response.arrayBuffer());
    if (!audio.length) throw new HandoffError(502, 'TTS_EMPTY_AUDIO');
    await mkdir(cacheDir, { recursive: true, mode: 0o700 });
    const temporary = join(cacheDir, `${key}.${randomUUID()}.tmp`);
    await writeFile(temporary, audio, { mode: 0o600 });
    await rename(temporary, path);
    return audio;
  }
  return async (request: Request): Promise<Response> => {
    const json = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
    const secret = (options.secret ?? (() => process.env.TOOL_GATEWAY_SECRET))();
    if (!secret) return json('GATEWAY_NOT_CONFIGURED', 503);
    const actual = createHash('sha256').update(request.headers.get('authorization') ?? '').digest();
    const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
    if (!timingSafeEqual(actual, expected)) return json('UNAUTHORIZED', 401);
    if (request.method !== 'POST') return json('METHOD_NOT_ALLOWED', 405);
    let body: unknown;
    try {
      const raw = await request.text();
      if (Buffer.byteLength(raw) > 4096) return json('BODY_TOO_LARGE', 413);
      body = JSON.parse(raw);
    } catch { return json('INVALID_JSON', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json('INVALID_HANDOFF', 400);
    const { role, text } = body as Record<string, unknown>;
    if (Object.keys(body).sort().join(',') !== 'role,text' || typeof role !== 'string' || !Object.hasOwn(voices, role)
      || typeof text !== 'string' || !text.trim() || Array.from(text).length > 240 || /[\x00-\x1f\x7f<>]/.test(text)) return json('INVALID_HANDOFF', 400);
    const key = createHash('sha256').update(JSON.stringify([HANDOFF_MODEL, voices[role as HandoffRole].id, text, 'wav-pcm_s16le-24000-en'])).digest('hex');
    try {
      let work = pending.get(key);
      if (!work) {
        if (pending.size >= 5) return json('TTS_BUSY', 429);
        work = synthesize(text, role as HandoffRole, key); pending.set(key, work);
        void work.finally(() => pending.delete(key)).catch(() => {});
      }
      const audio = await work;
      return new Response(Buffer.from(audio), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } });
    } catch (error) {
      return json(error instanceof HandoffError ? error.message : 'TTS_UNAVAILABLE', error instanceof HandoffError ? error.status : 503);
    }
  };
}
