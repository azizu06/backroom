# Cartesia at Cal Hacks 13.0

Checked 2026-10-24 against the [Cal Hacks starter pack](https://docs.cartesia.ai/calhacks),
[current Sonic model](https://docs.cartesia.ai/build-with-cartesia/tts-models/latest),
[Managed Agent configuration](https://docs.cartesia.ai/agents/configuration),
[pricing](https://docs.cartesia.ai/pricing), [plan features](https://cartesia.ai/pricing),
and [concurrency limits](https://docs.cartesia.ai/use-the-api/concurrency-limits-and-timeouts).

## Startup and what we use

Startup currently lists $49/month, 1.25M model credits/month and $49 prepaid
agent dollars/month. It includes commercial use, instant cloning, two pro voice
clone slots, organizations, five simultaneous TTS requests and twenty STT requests.
Managed Agent call concurrency is a separate limit; do not infer it from TTS.
The account snapshot supplied for this task was 1,269,335 model credits and $49.73
agent dollars after the hackathon promo. Those are a point-in-time balance, not
our monthly allowance or a new live dashboard reading.

**The plan renews November 24, 2026. Cancel before November 24 to avoid renewal.**
The account owner must do this in subscription settings; this implementation does
not change billing. Paid agent usage can continue beyond prepaid dollars and LLM
charges are additional, so the account balance is not a hard spending cap.

We use seven distinct provider library voices for responsibility-specific handoffs,
Sonic 3.6 for short office narration, and Managed Agents for the live collections
conversation and its nine server-gated tools. This makes handoffs audible and the
collections flow conversational while code owns the money and the record. We do
not clone teammates or other people. Cloning, multilingual output, voice localization
and background sound are available capabilities, not features we claim to have built.
The Cal Hacks criteria are 25% each for problem/originality, meaningful Cartesia use,
execution, and impact/responsibility. Demo one complete gated collections flow and
use short handoffs to explain who owns each step; extra narration is not an approval.

## Handoff endpoint and office contract

Implementation: `orchestrator/src/voice/handoff.ts`; server-only voice IDs and role
rationale: `orchestrator/src/voice/voices.ts`. Library entries were verified with
`GET /voices` (all seven `is_owner=false`). The model is pinned to the documented
stable snapshot `sonic-3.6-2026-08-27` for repeatable cached output.

From the repo root, with team `.env.local` available:

```sh
node --env-file=.env.local --import ./orchestrator/node_modules/tsx/dist/loader.mjs orchestrator/src/voice/handoff-server.ts
```

This private service listens on `127.0.0.1:8789` (`HANDOFF_PORT` overrides).
`POST /api/handoff` requires `Authorization: Bearer <TOOL_GATEWAY_SECRET>`.
Body must contain exactly `{role,text}`, for example:

```json
{"role":"extractor","text":"Extractor to Vendor verifier: invoice 4419 is ready for checks."}
```

Roles: `intake_sorter`, `extractor`, `vendor_verifier`, `payables`,
`collections_caller`, `reconciler`, `auditor`.
Response: binary `audio/wav`, 24 kHz signed 16-bit PCM, `Cache-Control: no-store`.
Errors are JSON `{error:string}`: 400 invalid input, 401 unauthorized, 405 wrong
method, 413 oversized body, 429 busy/budget, 502 provider failure, 503 unavailable.
Maximum text length is 240 Unicode code points; control characters and markup are
rejected. No synthesis retries. A 429 is permission to skip narration, not retry
in a tight loop. Narration failure must never block a business handoff.

Diego can import `getHandoffAudio` and `HandoffLine` from
`@backroom/orchestrator/handoff-client`. When a handoff row lands, call
`getHandoffAudio({role,text}, controllerTransport)` to obtain a WAV Blob. The
transport calls `/api/handoff` through a trusted server/controller proxy which
checks the office session and adds the bearer server-side. The default transport
is same-origin fetch. A server can alternatively import `createHandoffHandler`
from `@backroom/orchestrator/handoff` and instantiate it once behind its controller
authorization layer. This PR does not install that proxy or edit office files;
a raw browser request to the private service has no authorization. Never put
Cartesia keys or `TOOL_GATEWAY_SECRET` in props, browser storage, client headers,
or `NEXT_PUBLIC_*`. Enable audio with a user gesture, queue short clips, and revoke
object URLs after playback. Only speak trusted summaries, not raw email text or
bank/account details. The helper does not trigger payments or create agent tasks.

Cache files live in gitignored `.env.voice/handoff-cache` relative to the server's
working directory (directory 0700, files 0600). Keys hash text + voice + model +
output settings; transcripts do not appear in filenames. Audio still contains
spoken data: use synthetic demo summaries and delete the local cache after the
event if it contains anything sensitive. Completed cache hits work across restarts
and make no paid request, even with budget zero or no Cartesia key.

The server instantiates one handler per process. Its default character budget is
20,000 (`CARTESIA_TTS_CHARACTER_BUDGET`, nonnegative integer). It reserves characters
before each provider attempt, including ambiguous failures, deduplicates identical
in-flight requests, and allows at most five pending unique requests. Restarting
resets the budget; it is not a distributed/account-wide billing cap. Multiple
service processes do not coordinate cache misses, so run one demo instance.

## Collections config and live retest

`managedConfig` in `orchestrator/src/voice/tools.ts` now uses Jacqueline (the same
library identity as the Collections caller), explicit natural speed/volume 1.0,
and recognition keyterms for Northfield, invoice, installments and contact name.
Maximum noise suppression remains appropriate for the hackathon floor. Speculative
generation is enabled: documented eager generation lowers response latency, but
speech and tool execution wait until confirmed end-of-turn. Interrupted speculative
responses are discarded and may still consume LLM tokens.

The current Managed Agent schema exposes voice/speed/volume, not a Sonic model
selector or general interruption-sensitivity control. Do not invent those fields
or claim the managed backend was pinned to Sonic 3.6. The standalone TTS path uses
that model explicitly. Existing LLM choice, inactivity settings, initial disclosure,
identity gate, consent/calling-hours checks, stop handling and all nine tool schemas
are unchanged. There is still no documented non-interruptible greeting switch;
the relay requires complete disclosure and instructions repeat it after interruption.

These are source config changes, not an update to a running provider agent. On the
owned collections deployment, run the existing `voice/live.ts setup` path to apply
its config after preserving the correct resources and relay URL. This task placed
no phone calls and did not reconfigure a shared live agent. A separately authorized
live retest should check:

- Full AI/recording disclosure, interrupt mid-greeting, and no amount before identity.
- Natural identity reply, invoice/number recognition, no double tool execution when
  a caller resumes speaking during eager generation, and responsive barge-in.
- Allowed plan, four-installment escalation, controller passkey approval, no voice
  approvals, exact returned URL/code, and no claim that an SMS was sent.
- Opt-out, bankruptcy, dispute, already-paid and wrong-person paths still stop safely.
- Response latency and audible quality in room noise, call completion and budget
  receipts. See `orchestrator/src/voice/README.md` for the existing controlled dial flow.

## Credit math and verification

[Cartesia pricing](https://docs.cartesia.ai/pricing) separates model credits from
agent dollars. TTS is approximately one credit per character (normalization can
slightly change billed credits). Ink 2 realtime STT is three credits/second;
standalone STT is not needed for the cached handoff endpoint. Managed Agent calls
cost $0.06/minute plus $0.014/minute for Cartesia-number telephony, plus LLM tokens.
Do not subtract calls from the TTS balance or double-count standalone STT for them.

A five-minute phone demo costs $0.37 before LLM tokens; ten rehearsals of that
length cost $3.70 before LLM tokens. At $0.074/minute, $49.73 covers approximately
672 minutes before LLM costs. One hundred unique 100-character handoffs use about
10,000 credits (0.79% of the supplied balance); repeating cached lines adds zero
TTS requests. Ten minutes of separate Ink 2 audio would use 1,800 credits.

Unit tests mock provider traffic:

```sh
pnpm --filter @backroom/orchestrator exec vitest run src/voice
pnpm --filter @backroom/orchestrator build
```

Opt-in live smoke, from the root (seven sequential short lines, no calls):

```sh
CARTESIA_HANDOFF_LIVE=yes node --env-file=.env.local --import ./orchestrator/node_modules/tsx/dist/loader.mjs orchestrator/src/voice/handoff-smoke.ts
```

Ran once on 2026-10-24 at 14:34 UTC: **7/7 WAV clips, 192 total input characters**
(about 192 credits; no provider billing reconciliation claimed). The private receipt
is `.env.voice/handoff-smoke.json`; audio stays in the private cache. The smoke
uses this same cache, so subsequent repeats can be free; its character total is
input length, not a billing receipt. No phone calls were placed.
