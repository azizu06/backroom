/** Server-only Cartesia batch STT and catalog-voice TTS. Never expose the API key. */
export class VoiceError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const MAX_CLIP_SECONDS = 15;
export const audioTypes = new Set(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/flac']);
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** Bounded even for chunked bodies or a dishonest Content-Length. */
export async function readBounded(stream: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!stream) throw new VoiceError('EMPTY_BODY', 400);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new VoiceError('BODY_TOO_LARGE', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

/** Retain each exact id, replacing punctuation with pauses rather than dropping it. */
export function spokenAnswer(answer: string): string {
  return answer.replace(/\[entry:([A-Za-z0-9_.:-]+)\]/g, (_, id: string) =>
    `entry ${id.replace(/[_.:-]+/g, ' ')}`);
}

export function createCartesia(apiKey: string, fetcher: typeof fetch = fetch) {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Cartesia-Version': '2026-08-14' };
  async function post(path: string, body: BodyInit, signal: AbortSignal, json = false) {
    const unavailable = path === '/stt' ? 'TRANSCRIPTION_UNAVAILABLE' : 'SPEECH_UNAVAILABLE';
    try {
      const response = await fetcher(`https://api.cartesia.ai${path}`, {
        method: 'POST', headers: { ...headers, ...(json ? { 'Content-Type': 'application/json' } : {}) },
        body, signal, redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new VoiceError(unavailable, 503);
      }
      return response;
    } catch { throw new VoiceError(unavailable, 503); }
  }
  return {
    async transcribe(clip: File, signal: AbortSignal): Promise<string> {
      const body = new FormData();
      // Do not forward the user's filename or other multipart fields.
      body.set('file', clip, 'question');
      body.set('model', 'ink-whisper');
      body.set('language', 'en');
      const response = await post('/stt', body, signal);
      const value = JSON.parse(Buffer.from(await readBounded(response.body, 65536)).toString('utf8'));
      if (typeof value.duration === 'number' && value.duration > MAX_CLIP_SECONDS + 1) throw new VoiceError('CLIP_TOO_LONG', 400);
      if (typeof value.text !== 'string' || !value.text.trim() || value.text.length > 1000) throw new VoiceError('INVALID_TRANSCRIPT', 422);
      return value.text.trim();
    },
    async speak(answer: string, signal: AbortSignal) {
      const response = await post('/tts/bytes', JSON.stringify({
        model_id: 'sonic-3', transcript: spokenAnswer(answer),
        voice: process.env.CARTESIA_WHY_VOICE_ID || 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4',
        language: 'en', output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 24000 },
      }), signal, true);
      const bytes = await readBounded(response.body, MAX_RESPONSE_BYTES);
      if (!bytes.length) throw new VoiceError('SPEECH_UNAVAILABLE', 503);
      return { mimeType: 'audio/wav' as const, base64: Buffer.from(bytes).toString('base64') };
    },
  };
}
