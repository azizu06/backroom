# Ask why by voice (#23)

`web/components/AskWhyVoice.tsx` is an unmounted, unstyled push-to-talk component.
The office/wall can mount `<AskWhyVoice onAnswer={answer => ...} />`; `onAnswer`
receives the response, including exact citation ids for selecting audit rows.
Pointer hold and Space/Enter hold record mono audio for at most 15 seconds.
Release submits; releasing while microphone permission is pending cancels it.
Blur, pointer cancellation, unmount, and recording errors release microphone tracks.
HTTPS (or localhost) and microphone permission are required. A typed question form
is always available, including when recording or STT is unavailable. Native audio
controls provide playback when the browser blocks autoplay. Audio is disclosed as
sent to Cartesia before recording; there is no voice cloning or approval path.

## HTTP contract

- `POST /api/why/voice`: multipart form containing exactly one `audio` file,
  maximum 2 MiB (request maximum includes 64 KiB multipart overhead).
  WebM/Opus, MP4, Ogg, WAV, MP3 and FLAC MIME types are accepted.
- `POST /api/why`: JSON `{ "question": "Why did you hold invoice 4419?" }`.
  Questions must contain 1–1000 characters. Both paths return the same shape.

```json
{
  "question": "Why did you hold invoice 4419?",
  "answer": "Recorded denied ... [entry:212]",
  "citations": ["212"],
  "source": "fallback",
  "audio": { "mimeType": "audio/wav", "base64": "..." },
  "audioError": null,
  "latencyMs": 2922
}
```

`audio` may be null; TTS failure preserves the cited text and sets a bounded
`audioError`. No evidence produces the existing explicit ungrounded refusal, never
invented citations. Inline `[entry:ID]` remains in displayed text; speech renders
it as “entry ID”, with punctuation in an id replaced by spaces for pronunciation.
The original id always remains in `citations`.

Set server-only `CARTESIA_API_KEY` and `WEBAUTHN_ORIGIN` (exact browser origin).
Optional `CARTESIA_WHY_VOICE_ID` selects a **catalog** voice, defaulting to the
voice in Cartesia's bytes example. Never put keys in client props or NEXT_PUBLIC.
The Origin boundary follows the demo's controller transport: no cross-origin
requests, no CORS, and `Cache-Control: no-store`. It is not user authentication or
multi-tenant authorization. Do not expose this demo's financial audit endpoint as
a public multi-tenant API without an authenticated caller-scoped loader.

The server reads the shared `getStateStore()` at request time, verifies the full
snapshot hash chain via exported `verifyChain`, and projects only recorded policy
decisions into the exported #35 `askWhy` service. Client-supplied entries are
rejected. ALLOW is described as permission, never proof of a payment. The existing
service strips unknown input fields, uses `route('ask_why', ...)`, validates
citations, and falls back to recorded evidence. No new model or state writer is
introduced. Bootstrap must install the durable StateStore before serving real
data; an empty development store yields an ungrounded refusal.

OFF blocks STT/TTS and cancels in-flight speech work using the shared generation
signal. Typed questions still get deterministic cited answers while OFF. Speech
provider requests have a 45-second overall signal, bounded response bodies, and
fixed sanitized errors. Audio is not persisted. The browser caps capture time;
the server additionally rejects a provider-reported duration above 16 seconds.
The byte limit bounds uploads; it cannot prove duration before transcription.

## Cartesia docs and account verification

Verified 2026-10-24 against primary docs:

- [Batch STT](https://docs.cartesia.ai/api-reference/stt/transcribe): `POST /stt`,
  multipart `file`, `model=ink-whisper`, `language=en`; response `text` and
  `duration`. Includes WebM, WAV and MP4 uploads. Ink-2 is not the batch model.
- [TTS bytes](https://docs.cartesia.ai/api-reference/tts/bytes): `POST /tts/bytes`,
  `model_id`, `transcript`, catalog `voice`, WAV output configuration.

Both use `Authorization: Bearer` and `Cartesia-Version: 2026-08-14`.
This implementation pins `sonic-3` for TTS. A real account run successfully
transcribed the synthetic question and generated all five cited spoken answers;
STT access on the team account is verified, not inferred from docs.

## Validation and latency receipt

```sh
pnpm --filter @backroom/web exec vitest run lib/why-voice/http.test.ts
pnpm -r test
pnpm -r build

# Opt-in paid Cartesia calls: from repo root with ignored team .env.local.
WHY_VOICE_LIVE=1 pnpm --filter @backroom/orchestrator exec node \
  --env-file="$PWD/.env.local" --import tsx ../tools/why-voice-live.ts
```

The live script generates one synthetic question using the catalog voice, then
performs five sequential **local HTTP** uploads through the real handler, real
Cartesia STT and real Cartesia TTS. It uses an isolated, valid synthetic audit
chain and intentionally clears the OpenRouter key **within that script process**
to exercise cited deterministic fallback (the account currently returns 402).
No cloud-model answer quality or cloud-model latency is claimed.
`WHY_VOICE_CLIP=/absolute/path.wav` optionally supplies an existing question clip
instead; `WHY_VOICE_CLIP_TYPE` defaults to `audio/wav`.

Measured 2026-10-24, upload start to complete playable WAV response, in milliseconds:

| Run | End to end | Server | Answer source | Citation |
| --- | ---: | ---: | --- | --- |
| 1 | 3210 | 3202 | fallback | 212 |
| 2 | 2851 | 2843 | fallback | 212 |
| 3 | 2922 | 2910 | fallback | 212 |
| 4 | 2879 | 2864 | fallback | 212 |
| 5 | 3095 | 3091 | fallback | 212 |

**p50 end to end: 2922 ms.** This includes full answer synthesis and base64 HTTP
transport, excludes recording duration, initial synthetic-question generation,
permission interaction and playback. These are localhost fixture measurements,
not deployed or browser microphone measurements. All five returned citation 212
and nonempty WAV audio (753,520–827,080 bytes).

Headless Chromium verification (mock microphone/HTTP) also passed pointer hold,
Space hold, typed fallback, permission-pending release cancellation and track
cleanup with zero browser page errors. No signed-in Chrome tab was used.
