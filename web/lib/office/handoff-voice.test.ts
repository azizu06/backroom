// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createHandoffProxy, HANDOFF_UPSTREAM } from './handoff-proxy';
import { HandoffVoice, createAudioPlayer, unlockOnGesture, handoffVoiceLine, liveVoiceCues, voiceCues, type VoiceCue } from './handoff-voice';
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
  it('uses the row voice role and line verbatim; short role ids are not voice aliases', () => {
    expect(handoffVoiceLine('intake_sorter', 'New invoice')).toEqual({ role: 'intake_sorter', text: 'New invoice' });
    expect(handoffVoiceLine('vendor_verifier', 'Verify remit-to')).toEqual({ role: 'vendor_verifier', text: 'Verify remit-to' });
    expect(handoffVoiceLine('intake', 'x')).toBeNull();
    expect(handoffVoiceLine('vendor', 'x')).toBeNull();
    expect(handoffVoiceLine('human', 'Passkey needed')).toBeNull();
  });
  it('drops unsafe or overlong text instead of inventing a spoken fallback', () => {
    expect(handoffVoiceLine('auditor', '<b>mismatch</b>')).toBeNull();
    expect(handoffVoiceLine('auditor', 'y'.repeat(241))).toBeNull();
    expect(handoffVoiceLine('auditor', ' ')).toBeNull();
  });
  it('cues the author on offered with its masked line unchanged, and never voices a terminal row', () => {
    const row = { handoffId: 'f', sequence: 0n, caseDisplayId: 'INV-1', fromAgentId: 'extractor-agent', toAgentId: 'vendor-agent',
      fromRole: 'extractor' as const, toRole: 'vendor' as const, fromVoiceRole: 'extractor', toVoiceRole: 'vendor_verifier',
      status: 'offered' as const, correction: false, reason: 'Human approval escalation', summary: 'Public display summary', line: 'Verify GB29 NWBK ••6819 for [email] (••6819).', createdAt: 1000 };
    const cues = voiceCues(planHandoffs([row]));
    expect(cues).toEqual([{ key: 'f', at: 1000, line: { role: 'extractor', text: row.line } }]);
    for (const status of ['accepted', 'completed', 'rejected'] as const) {
      expect(voiceCues(planHandoffs([{ ...row, status, acceptedAt: 2000, completedAt: 3000 }]))).toEqual([]);
    }
    expect(voiceCues(planHandoffs([{ ...row, line: '' }]))).toEqual([]);
    const queued = { ...row, handoffId: 'queued', sequence: 1n };
    expect(voiceCues(planHandoffs([row, queued])).map(cue => cue.key)).toEqual(['f']);
  });
});

describe('HandoffVoice', () => {
  const cue = (key: string): VoiceCue => ({ key, at: 0, line: { role: 'auditor', text: key } });
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  it('defaults on, honors explicit off, then speaks each cue once when reenabled', async () => {
    const fetchAudio = vi.fn(async () => new Blob(['x']));
    const play = vi.fn(async () => {});
    const voice = new HandoffVoice(fetchAudio, play);
    expect(voice.enabled).toBe(true);
    voice.setEnabled(false);
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
  it.each([400, 401, 403, 404, 405, 413, 415, 429, 500, 502, 503, 504, 'timeout', 'playback'])('drops only the failed line (%s) and keeps voices on', async status => {
    const fetchAudio = vi.fn().mockResolvedValue(new Blob(['x']));
    const play = vi.fn().mockResolvedValue(undefined);
    if (status === 'playback') play.mockRejectedValueOnce(new Error('HANDOFF_AUDIO_PLAYBACK'));
    else fetchAudio.mockRejectedValueOnce(status === 'timeout' ? new DOMException('Timed out', 'TimeoutError') : new Error(`HANDOFF_AUDIO_HTTP_${status}`));
    const voice = new HandoffVoice(fetchAudio, play);
    voice.say(cue('failed'));
    voice.say(cue('next'));
    await flush();
    expect(voice.enabled).toBe(true);
    expect(fetchAudio).toHaveBeenCalledTimes(2);
    expect(play).toHaveBeenCalledTimes(status === 'playback' ? 2 : 1);
  });
  it('drops an autoplay-blocked line and plays the next line after a gesture', async () => {
    const play = vi.fn().mockRejectedValueOnce(new DOMException('User gesture required', 'NotAllowedError')).mockResolvedValue(undefined);
    const voice = new HandoffVoice(async () => new Blob(['x']), play);
    voice.setEnabled(true);
    voice.say(cue('a'));
    await flush(); await flush();
    expect(voice.enabled).toBe(true);
    voice.say(cue('after-gesture'));
    await flush();
    expect(play).toHaveBeenCalledTimes(2);
  });
});

describe('HandoffVoice review fixes', () => {
  const cue = (key: string): VoiceCue => ({ key, at: 0, line: { role: 'auditor', text: key } });
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  it('does not play a line that finished synthesizing after sound was turned off', async () => {
    let release!: (blob: Blob) => void;
    const play = vi.fn(async () => {});
    const voice = new HandoffVoice(() => new Promise<Blob>(resolve => { release = resolve; }), play);
    voice.setEnabled(true);
    voice.say(cue('slow'));
    await flush();
    voice.setEnabled(false);
    release(new Blob(['x']));
    await flush(); await flush();
    expect(play).not.toHaveBeenCalled();
    expect(voice.enabled).toBe(false);
  });
  it('aborts the clip that is playing when sound is turned off', async () => {
    let signal!: AbortSignal;
    const voice = new HandoffVoice(async () => new Blob(['x']), (_blob, abort) => { signal = abort; return new Promise(resolve => abort.addEventListener('abort', () => resolve())); });
    voice.setEnabled(true);
    voice.say(cue('a'));
    await flush(); await flush();
    voice.setEnabled(false);
    expect(signal.aborted).toBe(true);
  });
  it('drops only the line on a slow or unreachable voice server (502/504)', async () => {
    const voice = new HandoffVoice(async () => { throw new Error('HANDOFF_AUDIO_HTTP_502'); }, vi.fn(async () => {}));
    voice.setEnabled(true);
    voice.say(cue('a'));
    await flush(); await flush();
    expect(voice.enabled).toBe(true);
  });
});

describe('handoff proxy body cap', () => {
  it('rejects an oversized body that has no Content-Length without buffering it all', async () => {
    const big = new TextEncoder().encode(JSON.stringify({ role: 'auditor', text: 'x'.repeat(10_000) }));
    const stream = new ReadableStream({ start(controller) { controller.enqueue(big.slice(0, 3000)); controller.enqueue(big.slice(3000)); controller.close(); } });
    const request = new Request(`${ORIGIN}/api/handoff`, { method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'application/json', origin: ORIGIN } } as RequestInit);
    const transport = vi.fn();
    expect((await proxy(transport as unknown as typeof fetch)(request)).status).toBe(413);
    expect(transport).not.toHaveBeenCalled();
  });
});


describe('office voice gesture unlock', () => {
  it.each(['pointerdown', 'keydown'])('keeps %s and both gesture types armed until cleanup', event => {
    const target = new EventTarget();
    const unlock = vi.fn();
    const cleanup = unlockOnGesture(target, unlock);
    target.dispatchEvent(new Event(event));
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('keydown'));
    expect(unlock).toHaveBeenCalledTimes(3);
    cleanup();
  });
  it('removes listeners when the office unmounts before a gesture', () => {
    const target = new EventTarget();
    const unlock = vi.fn();
    unlockOnGesture(target, unlock)();
    target.dispatchEvent(new Event('keydown'));
    expect(unlock).not.toHaveBeenCalled();
  });
  it('unlocks the audio player once and plays the next cue after a gesture', async () => {
    const audio = Object.assign(new EventTarget(), { src: '', play: vi.fn(async () => {}), pause: vi.fn() });
    vi.stubGlobal('Audio', function () { return audio; });
    try {
      const target = new EventTarget();
      const player = createAudioPlayer();
      unlockOnGesture(target, player.unlock);
      expect(audio.play).not.toHaveBeenCalled();
      target.dispatchEvent(new Event('pointerdown'));
      expect(audio.play).toHaveBeenCalledTimes(1);
      target.dispatchEvent(new Event('keydown'));
      const played = player.play(new Blob(['x']), new AbortController().signal);
      expect(audio.play).toHaveBeenCalledTimes(2);
      audio.dispatchEvent(new Event('ended'));
      await played;
    } finally { vi.unstubAllGlobals(); }
  });
  it('re-unlocks after blocked playback on the next gesture without replacing active audio', async () => {
    const audio = Object.assign(new EventTarget(), { src: '', play: vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError')).mockResolvedValue(undefined), pause: vi.fn() });
    vi.stubGlobal('Audio', function () { return audio; });
    try {
      const target = new EventTarget();
      const player = createAudioPlayer();
      const cleanup = unlockOnGesture(target, player.unlock);
      target.dispatchEvent(new Event('pointerdown'));
      await expect(player.play(new Blob(['x']), new AbortController().signal)).rejects.toMatchObject({ name: 'NotAllowedError' });
      target.dispatchEvent(new Event('keydown'));
      expect(audio.play).toHaveBeenCalledTimes(3);
      const played = player.play(new Blob(['next']), new AbortController().signal);
      target.dispatchEvent(new Event('pointerdown'));
      expect(audio.play).toHaveBeenCalledTimes(4);
      audio.dispatchEvent(new Event('ended'));
      await played;
      cleanup();
    } finally { vi.unstubAllGlobals(); }
  });
  it('cleanup stops playback without turning the default off', () => {
    const voice = new HandoffVoice(vi.fn(), vi.fn());
    voice.stop();
    expect(voice.enabled).toBe(true);
    voice.setEnabled(false);
    voice.stop();
    expect(voice.enabled).toBe(false);
    expect(new HandoffVoice(vi.fn(), vi.fn()).enabled).toBe(true); // Remounts never persist OFF.
  });
  it('skips playback before unlock without creating audio or throwing', async () => {
    const player = createAudioPlayer();
    await expect(player.play(new Blob(['x']), new AbortController().signal)).resolves.toBeUndefined();
  });
});

// Live snapshots can coalesce offered -> accepted -> completed into one update.
describe('live workday voice cues', () => {
  it('voices newly published terminal rows independently of visual desk availability', () => {
    const row = { handoffId: 'new', sequence: 1n, caseDisplayId: 'INV-1', fromAgentId: 'extractor-1', toAgentId: 'vendor-1',
      fromRole: 'extractor' as const, toRole: 'vendor' as const, fromVoiceRole: 'extractor', toVoiceRole: 'vendor_verifier',
      status: 'completed' as const, correction: false, reason: '', summary: '', line: 'Fields validated.', createdAt: 5000 };
    for (const status of ['offered', 'accepted', 'completed', 'rejected'] as const) {
      expect(liveVoiceCues([{ ...row, status }], 4000)).toEqual([{ key: 'new', at: 5000, line: { role: 'extractor', text: row.line } }]);
    }
    expect(liveVoiceCues([row], 6000)).toEqual([]); // Existing history on page load.
    expect(liveVoiceCues([{ ...row, line: '<unsafe>' }], 4000)).toEqual([]);
  });
});
