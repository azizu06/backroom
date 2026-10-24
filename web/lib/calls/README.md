# Office calls: Request call button and desk phone feed

The office desk phone (`web/lib/office/calls.ts`) uses three host routes. All are
server-side; no number, secret or session id reaches the browser.

| Route | Auth | Does |
|---|---|---|
| `POST /api/calls/session` | `{ code }` = operator code (`CONTROLLER_ENROLLMENT_SECRET`, same as the audit wall), from `WEBAUTHN_ORIGIN` or `http://127.0.0.1:$DEMO_PORT` | Sets `backroom_calls`, HttpOnly, SameSite=Strict, `Path=/api/calls`, 12 h. `Secure` only when that origin is https |
| `POST /api/calls/request` | that cookie + `Origin` is `WEBAUTHN_ORIGIN` or `http://127.0.0.1:$DEMO_PORT` | Dials once through the relay's `/_admin/dial` |
| `GET /api/calls/active` | none (carries no secrets) | Read-only projection of the latest voice call, `no-store` |

**Before judging**, open the office at `http://127.0.0.1:$DEMO_PORT/office`. The
tunnel page cannot open the state socket, so it has no Request call button. The
first click answers "Calls are locked" with an Unlock link to `/calls` on that same
loopback origin. Enter the operator code (`CONTROLLER_ENROLLMENT_SECRET` in
`.demo/private.env`). After that, each click rings the allowlisted phone, with no
CLI step. A public origin still has to be `WEBAUTHN_ORIGIN` exactly.

`request` accepts only `{}` or `{ "line": "collections" }`. The destination is the
relay's `T1_DIAL_TO`, never request input. It refuses when voice is not running
(`DEMO_VOICE_RUNNING=1` and `VOICE_ADMIN_SECRET` come from `demo:up`), while a
request is in flight, while the feed shows a ringing/live call, and for 20 s after
the last attempt or call end. It persists `office_call_requested` to the shared
audit chain **before** forwarding (no audit, no dial), then `office_call_accepted`
or `office_call_refused` with the relay's code. Unauthenticated refusals are
coalesced to one row per code per 10 s. The relay's own gate (pre-call `ready`,
one call on the line) is described in `orchestrator/src/voice/README.md`.

`active` projects `GatewayStore.latestVoiceCall()` plus provider lifecycle
(`lifecycle.ts`, pushed by the relay over the host's loopback). Status: no
`call_started` and no gateway audit is `ringing` (90 s, then "No answer"); started
or any audit is `live` (10 min cap); `call_completed`/`call_failed` or a stopped
gateway status (opt-out, dispute, human, already paid) is `ended`, hidden 2 min
after the end. The transcript is code decisions from gateway audits, never speech:
identity result, `propose_plan → DENY FEES_NON_WAIVABLE`, `ESCALATE … → Dana`,
Dana's passkey result from the StateStore, link queued. Amounts read `$•••`, and
plan terms such as installments, a waived fee, or a discount percent stay hidden, until
identity is confirmed. Rows never include the phone number, contact name, payment
link path or code, or the raw session id. State is process-local, like the gateway.

```sh
pnpm --filter @backroom/web exec vitest run --globals lib/calls lib/office/calls
pnpm --filter @backroom/orchestrator exec vitest run src/voice
```
