// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHandoffProxy, HANDOFF_UPSTREAM } from './handoff-proxy';
import { HandoffVoice, handoffVoiceLine, voiceCues, type VoiceCue } from './handoff-voice';
import { planHandoffs } from './handoff-plan';

const ORIGIN = 'http://localhost:3035';
function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/handoff`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers } });
}
function proxy(transport: typeof fetch, secret: string | undefined = 's3cret') {
  return createHandoffProxy({ origin: () => ORIGIN, secret: () => secret, transport });
}
const wav = () => new Response(new Uint8Array([82, 73, 70, 70]), { headers: { 'Content-Type': 'audio/wav' } });

describe('handoff voice proxy', () => {
  it('forwards a valid line with the secret added server-side and streams the WAV back', async () => {
    const transport = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => wav());
    const response = await proxy(transport as unknown as typeof fetch)(post({ role: 'extractor', text: 'Remit-to matches' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav');
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe(HANDOFF_UPSTREAM);
    expect(HANDOFF_UPSTREAM).toBe('http://127.0.0.1:8789/api/handoff');
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer s3cret');
    expect(JSON.parse(String(init!.body))).toEqual({ role: 'extractor', text: 'Remit-to matches' });
  });
  it.each([
    ['another origin', post({ role: 'extractor', text: 'hi' }, { origin: 'https://evil.example' }), 403],
    ['a non-JSON body', post('x', { 'content-type': 'text/plain' }), 415],
    ['extra keys', post({ role: 'extractor', text: 'hi', voice: 'x' }), 400],
    ['an unknown role', post({ role: 'human', text: 'hi' }), 400],
    ['markup', post({ role: 'auditor', text: '<b>hi</b>' }), 400],
    ['control characters', post({ role: 'auditor', text: 'a\u0007b' }), 400],
    ['over 240 characters', post({ role: 'auditor', text: 'x'.repeat(241) }), 400],
    ['an oversized body', post({ role: 'auditor', text: 'x'.repeat(5000) }), 413],
    ['bad JSON', post('{'), 400],
  ])('rejects %s before calling the voice server', async (_, request, status) => {
    const transport = vi.fn();
    expect((await proxy(transport as unknown as typeof fetch)(request)).status).toBe(status);
    expect(transport).not.toHaveBeenCalled();
  });
  it('is unavailable without a secret, and maps upstream failures without leaking their body', async () => {
    expect((await proxy(vi.fn() as unknown as typeof fetch, "")(post({ role: 'payables', text: 'hi' }))).status).toBe(503);
    const busy = await proxy((async () => Response.json({ error: 'TTS_BUSY', detail: 'secret stuff' }, { status: 429 })) as unknown as typeof fetch)(post({ role: 'payables', text: 'hi' }));
    expect(busy.status).toBe(429);
    expect(await busy.json()).toEqual({ error: 'VOICE_REJECTED' });
    const down = await proxy((async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch)(post({ role: 'payables', text: 'hi' }));
    expect(down.status).toBe(502);
    const html = await proxy((async () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } })) as unknown as typeof fetch)(post({ role: 'payables', text: 'hi' }));
    expect(html.status).toBe(502);
  });
  it('refuses other methods', async () => {
    expect((await proxy(vi.fn() as unknown as typeof fetch)(new Request(`${ORIGIN}/api/handoff`))).status).toBe(405);
  });
});

describe('handoff voice lines', () => {
  it('maps agents to voice roles and gives Dana no voice', () => {
    expect(handoffVoiceLine('intake', 'New invoice')).toEqual({ role: 'intake_sorter', text: 'New invoice' });
    expect(handoffVoiceLine('collections', 'x')?.role).toBe('collections_caller');
    expect(handoffVoiceLine('human', 'Passkey needed')).toBeNull();
    expect(handoffVoiceLine('mystery', 'x')).toBeNull();
  });
  it('cleans text to the server rules', () => {
    expect(handoffVoiceLine('auditor', '✕ Remit <b>mismatch</b>\n')?.text).toBe('Remit bmismatch/b');
    expect(Array.from(handoffVoiceLine('auditor', 'y'.repeat(400))!.text)).toHaveLength(240);
    expect(handoffVoiceLine('auditor', ' \n ')).toBeNull();
  });
  it('cues the delivery and the failed-check reason at their bubble times', () => {
    const plan = planHandoffs([{ id: 'f', from: 'extractor', to: 'vendor_verifier', item: 'INV-1', summary: 'Account mismatch', status: 'failed', at: 0 }]);
    const cues = voiceCues(plan);
    expect(cues.map(cue => [cue.line.role, cue.line.text])).toEqual([['extractor', 'INV-1 → Vendor verifier'], ['vendor_verifier', 'Account mismatch']]);
    expect(cues[0]!.at).toBeLessThan(cues[1]!.at);
  });
});

describe('HandoffVoice', () => {
  const cue = (key: string): VoiceCue => ({ key, at: 0, line: { role: 'auditor', text: key } });
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  it('stays silent until sound is enabled, then speaks each cue once', async () => {
    const fetchAudio = vi.fn(async () => new Blob(['x']));
    const play = vi.fn(async () => {});
    const voice = new HandoffVoice(fetchAudio, play);
    voice.say(cue('a'));
    await flush();
    expect(fetchAudio).not.toHaveBeenCalled();
    voice.setEnabled(true);
    voice.say(cue('b'));
    voice.say(cue('b'));
    await flush();
    expect(fetchAudio).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });
  it('falls back to silence on a fatal error and only drops the line when busy', async () => {
    let status = 429;
    const fetchAudio = vi.fn(async () => { throw new Error(`HANDOFF_AUDIO_HTTP_${status}`); });
    const voice = new HandoffVoice(fetchAudio, vi.fn(async () => {}));
    voice.setEnabled(true);
    voice.say(cue('a'));
    await flush();
    expect(voice.failed).toBe(false);
    status = 503;
    voice.say(cue('b'));
    await flush();
    expect(voice.failed).toBe(true);
    voice.say(cue('c'));
    await flush();
    expect(fetchAudio).toHaveBeenCalledTimes(2);
  });
  it('treats a blocked playback as silent fallback', async () => {
    const voice = new HandoffVoice(async () => new Blob(['x']), async () => { throw new Error('NotAllowedError'); });
    voice.setEnabled(true);
    voice.say(cue('a'));
    await flush(); await flush();
    expect(voice.failed).toBe(true);
  });
});
