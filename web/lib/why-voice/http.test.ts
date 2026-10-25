import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStateStore } from '@backroom/orchestrator';
import { createWhyHTTP } from './http';

async function setup(fetcher = vi.fn()) {
  const state = new MemoryStateStore();
  await state.setLlmEnabled(false);
  await state.appendAudit({ ts: 1, actor: 'code', seat: 'payables', action: 'pay_invoice', decision: 'DENY',
    ruleIds: ['DUPLICATE_INVOICE'], policyVersion: 1, refs: ['4419', '4402'], route: 'code', latencyMs: 0, costUsd: 0,
    inputs: { invoiceId: '4419', relatedInvoiceId: '4402', amountDelta: 37 } });
  return { state, fetcher, handle: createWhyHTTP({ state: () => state, origin: () => 'http://localhost:3000',
    apiKey: () => 'test-key', fetch: fetcher }) };
}
const text = (body: unknown, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/why', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
function voice() {
  const body = new FormData();
  body.set('audio', new Blob(['short clip'], { type: 'audio/webm' }), 'question.webm');
  return new Request('http://localhost:3000/api/why/voice', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body });
}

describe('ask-why HTTP', () => {
  beforeEach(() => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('uses verified server entries and preserves cited text while models are OFF', async () => {
    const { handle, fetcher } = await setup();
    const response = await handle(text({ question: 'Why did you hold invoice 4419?' }), 'text');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ citations: ['audit:2'], source: 'fallback', audio: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('transcribes a clip and returns linked text without reading citation ids aloud', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ text: 'Why did you hold invoice 4419?', duration: 3 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'Content-Type': 'audio/wav' } }));
    const { handle, state } = await setup(fetcher);
    await state.setLlmEnabled(true);
    const response = await handle(voice(), 'voice');
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ question: 'Why did you hold invoice 4419?', citations: ['audit:2'],
      audio: { mimeType: 'audio/wav', base64: 'UklGRg==' }, audioError: null });
    expect(result.answer).toContain('[entry:audit:2]');
    expect(fetcher.mock.calls[0]![0]).toBe('https://api.cartesia.ai/stt');
    const stt = fetcher.mock.calls[0]![1];
    expect(stt.body.get('model')).toBe('ink-whisper');
    expect(stt.body.get('file').type).toBe('audio/webm');
    expect(stt.headers.Authorization).toBe('Bearer test-key');
    const tts = JSON.parse(fetcher.mock.calls[1]![1].body);
    expect(tts.transcript).toContain('a possible duplicate invoice');
    expect(tts.transcript).not.toMatch(/entry audit 2|DUPLICATE_INVOICE|audit:2/);
    expect(tts.transcript).not.toContain('[entry:');
    expect(tts.output_format.container).toBe('wav');
  });
  it('keeps the cited text answer if Cartesia TTS is unavailable', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ text: 'Why invoice 4419?', duration: 2 }))
      .mockResolvedValueOnce(new Response('private provider diagnostics', { status: 403 }));
    const { state, handle } = await setup(fetcher);
    await state.setLlmEnabled(true);
    const response = await handle(voice(), 'voice');
    expect(await response.json()).toMatchObject({ citations: ['audit:2'], audio: null, audioError: 'SPEECH_UNAVAILABLE' });
  });

  it('rejects a foreign origin and client-supplied evidence before network work', async () => {
    const { handle, fetcher } = await setup();
    expect((await handle(text({ question: 'Why 4419?' }, 'https://evil.test'), 'text')).status).toBe(403);
    expect((await handle(text({ question: 'Why 4419?', entries: [{ id: 'fake' }] }), 'text')).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses a tampered server snapshot instead of grounding an answer in it', async () => {
    const { state, handle, fetcher } = await setup();
    const rows = await state.listAudit();
    rows[1]!.inputs = { invoiceId: '4419', amountDelta: 0 };
    vi.spyOn(state, 'listAudit').mockResolvedValue(rows);
    const response = await handle(voice(), 'voice');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'AUDIT_CHAIN_BROKEN' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('honors OFF without making STT or TTS calls', async () => {
    const { handle, fetcher } = await setup();
    const response = await handle(voice(), 'voice');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'LLM_OFF' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not send unsupported or oversized clips to a provider', async () => {
    const { handle, state, fetcher } = await setup();
    await state.setLlmEnabled(true);
    const body = new FormData();
    body.set('audio', new Blob(['text'], { type: 'text/plain' }), 'input');
    expect((await handle(new Request('http://localhost:3000/api/why/voice', { method: 'POST',
      headers: { origin: 'http://localhost:3000' }, body }), 'voice')).status).toBe(415);
    const chunked = new Request('http://localhost:3000/api/why/voice', { method: 'POST',
      headers: { origin: 'http://localhost:3000' }, body: new Uint8Array(2 * 1024 * 1024 + 65537) });
    expect((await handle(chunked, 'voice')).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns a bounded error on unavailable STT without exposing provider data', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('sk_private provider details', { status: 403 }));
    const { handle, state } = await setup(fetcher);
    await state.setLlmEnabled(true);
    const response = await handle(voice(), 'voice');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'TRANSCRIPTION_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('rejects blank or too-long transcripts and clips', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ text: ' ', duration: 1 }))
      .mockResolvedValueOnce(Response.json({ text: 'Why 4419?', duration: 30 }));
    const { handle, state } = await setup(fetcher);
    await state.setLlmEnabled(true);
    expect((await handle(voice(), 'voice')).status).toBe(422);
    expect((await handle(voice(), 'voice')).status).toBe(400);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('cancels an in-flight transcription when OFF is flipped', async () => {
    const { state } = await setup();
    await state.setLlmEnabled(true);
    const fetcher = vi.fn().mockImplementation(async (_url, init) => {
      await state.setLlmEnabled(false);
      expect(init.signal.aborted).toBe(true);
      return Response.json({ text: 'Why 4419?', duration: 2 });
    });
    const handle = createWhyHTTP({ state: () => state, origin: () => 'http://localhost:3000', apiKey: () => 'test', fetch: fetcher });
    const response = await handle(voice(), 'voice');
    expect(response.status).toBe(409);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports a provider connection failure as unavailable, not invalid user input', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('fetch failed with private diagnostics'));
    const { state, handle } = await setup(fetcher);
    await state.setLlmEnabled(true);
    const response = await handle(voice(), 'voice');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'TRANSCRIPTION_UNAVAILABLE' });
  });

  it('speaks the ungrounded refusal without inventing citation ids', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ text: 'Why invoice 9999?', duration: 2 }))
      .mockResolvedValueOnce(new Response('WAV bytes'));
    const { state, handle } = await setup(fetcher);
    await state.setLlmEnabled(true);
    const response = await handle(voice(), 'voice');
    expect(await response.json()).toMatchObject({ source: 'ungrounded', citations: [],
      answer: "I can't ground that answer in the available audit entries." });
    expect(JSON.parse(fetcher.mock.calls[1]![1].body).transcript).toBe("I can't ground that answer in the available audit entries.");
  });

});
