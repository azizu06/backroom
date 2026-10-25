# Office calls: Request call button and desk phone feed

The office desk phone (`web/lib/office/calls.ts`) uses four host routes. All are
server-side; no number, secret or session id reaches the browser.

| Route | Auth | Does |
|---|---|---|
| `POST /api/session` | `{ code }` = operator code (`CONTROLLER_ENROLLMENT_SECRET`), from `WEBAUTHN_ORIGIN`, `DEMO_PUBLIC_URL` or `http://127.0.0.1:$DEMO_PORT` | The shared operator sign-in (`web/lib/operator/sign-in.ts`): sets `backroom_session`, HttpOnly, SameSite=Strict, `Path=/`, 8 h, `Secure` on https. Five wrong codes lock that client out for 60 s |
| `POST /api/calls/request` | that cookie + `Origin` is `WEBAUTHN_ORIGIN` or `http://127.0.0.1:$DEMO_PORT` | Dials once through the relay's `/_admin/dial` |
| `GET /api/calls/active` | none (carries no secrets) | Read-only projection of the latest voice call, `no-store` |
| `GET /api/calls/precall` | none (carries no secrets) | Pre-call card above Request call: Apify business status, source label verbatim (live run id / FAKE / cached), source host, checked time, phone match, pre-call ready/blocked + reason, optional warnings. Reads evidence `prepare()` already fetched; starts no Apify or CRS check, `no-store` |

**Before judging**, open the office on the public URL and sign in once at
`/operator` (or `/calls`) with the operator code (`CONTROLLER_ENROLLMENT_SECRET` in
`.demo/private.env`). The office reaches live state through the host's same-origin
proxy (`web/lib/demo/state-proxy.ts`), so the public page has the desk phone. A
signed-out click answers "Calls are locked". After sign-in, each click rings the
allowlisted phone, with no CLI step. The host's loopback office works the same way.

`request` accepts only `{}`, `{ "line": "collections" }`, or a seeded email-only `scenario` (below). The destination is the
relay's `T1_DIAL_TO`, never request input. It refuses when voice is not running
(`DEMO_VOICE_RUNNING=1` and `VOICE_ADMIN_SECRET` come from `demo:up`), while a
request is in flight, while the feed shows a ringing/live call, and for 20 s after
the last attempt or call end. It persists `office_call_requested` to the shared
audit chain **before** forwarding (no audit, no dial), then `office_call_accepted`
or `office_call_refused` with the relay's code. Unauthenticated refusals are
coalesced to one row per code per 10 s. The relay's own gate (pre-call `ready`,
one call on the line) is described in `orchestrator/src/voice/README.md`.

For an authenticated `PRECALL_BLOCKED` or `CALL_DENIED`, the demo bootstrap asks
its existing agent host to rebuild the trusted pre-call case. Consumer, DNC and
missing-consent cases run through the production Collections planner and may queue
one `SIMULATED: email preview, not sent` per invoice/UTC day. The button result says
`Email preview (simulated, not sent)` after that queue reports queued, and
`Email preview already queued today (simulated, not sent); no second email.` after
duplicate. The shared audit records only the recipient domain; no delivery provider
is configured. Other refusal reasons keep the normal no-call response.

`/calls` also has **Email-only clients** buttons that post
`{ "line": "collections", "scenario": "consumer" | "opt_out" }`: the frozen C14
consumer and C12 opt-out overrides (`fixtures/scenarios/collections.json`) on
receivable 1042's client. The demo host runs them through the production pre-call
(`can_call` DENY audit row), and the route refuses `CALL_DENIED` before the relay,
call lock or cooldown, so nothing dials. The refusal then takes the follow-up path
above. Without the demo host it answers `SCENARIO_UNAVAILABLE`.

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
