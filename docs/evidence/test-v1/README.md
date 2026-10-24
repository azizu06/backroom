# V1 rehearsal — October 24, 2026

For the opt-in judge web host with real service adapters, see the newer
[live web walkthrough](live/README.md). The original default/mock evidence below
is retained as a dated receipt.

Rehearsed main `cec603e`, then rebased to `c2ed83b` and recaptured the full
browser walkthrough without dialing or using Aziz's Chrome.
`pnpm demo:up` started owned local SpacetimeDB 2.13.0, production Next, seat workers
and a public quick tunnel. All owned demo processes were stopped after validation.

- [Browser receipt](2026-10-24T13-09-01.380Z/receipt.json): controller enrollment,
  fresh reset, passkey denial, mock pay/reconciliation, both frozen inbox traps,
  exact audit replay, cited OFF why, real-vs-sim, policy save and next-request ALLOW.
  Each named step has a PNG beside the receipt. Browser authenticator is software.
- The same browser capture waits for the lazy canvas and visits all six manual
  camera presets, fixed view and the 2D fallback. The original public-tunnel take
  passed; a fresh tunnel take failed before the first screenshot. Final complete
  capture uses localhost:3300 with `DEMO_TUNNEL=0`; no tunnel availability claim
  is inferred from that final run.
- [Live GX10/Nessie receipt](../live-run/2026-10-24T13-00-43.020Z/receipt.json):
  all three moments pass; why source is `model`, local hard-task override uses
  `gpt-oss:120b`, extraction uses `gpt-oss:20b`. ON/OFF traps stay held, no trap
  bank effects, OFF why is deterministic. Actual local DB reducers and Nessie
  sandbox reads/reconciliation; synthetic caller and software test passkey.
  Bank display was read back; an existing installment may be reused idempotently.
  CRS and Apify inside this take remain fixtures, exactly as its receipt records.
- [Separate Apify probe](apify-live.json): one actual website-only Actor run,
  `SUCCEEDED`/complete, source URL + timestamp, 4.094 s health latency, max $0.10.
  No Maps claim, phone, model or live bank in that probe. No second Actor run.
- `demo:health --live`: web/seats, DB, GX10 model listing and tunnel pass. Voice
  relay disabled; Nessie account isn't configured in the team env, although the
  separate live script can seed/reuse its sandbox account. Cloud unverified.
- CRS probe skips: refreshed team env contains no username/password. Existing
  CRS sandbox evidence elsewhere is not a fresh successful probe by this worker.
- [Direct Claude smoke](../anthropic/live-2026-10-24T13-07-06-568Z.json) ran
  after the route merged: two HTTP 200 calls, schema-valid plan and grounded
  model why. Estimated usage cost **$0.011076 / $3 cap**; maximum reserved $0.75.
  Personal credential loaded from Keychain into ignored `.env.local` only.
  This is a separate smoke, not proof of an integrated live phone conversation.

Validation: `pnpm -r test` passes (95 policy, 343 orchestrator, 133 web, 14 state,
9 Nessie); `pnpm -r typecheck` passes; gateway Vitest passes 26/26. `demo:up`
builds production Next successfully. No unit test calls a real provider.

`demo:parity` failed at `web/scripts/parity.ts` `caughtUp()`: waiting for
`[data-audit-id="audit:1"]` without unlocking the private lobby wall. Exact repro
was posted to Diego on the board; his office/AuditWall files remain untouched.
Automated Tour is not on this main; room presets provide the manual tour.

Reproduce browser capture on a **freshly started, unenrolled** owned demo:

```sh
node tools/demo/rehearse.mjs
# To recapture only office views against an already running demo:
node tools/demo/rehearse.mjs --office-only
pnpm demo:down
```

Uses headless Playwright, no external model/Actor/bank calls, real browser HTTP
routes and Chromium's virtual WebAuthn authenticator. The script reads private
controls without printing them and closes Chromium even on failure. Run from
repo root; browser installation, if needed:
`pnpm --filter @backroom/web exec playwright install chromium`.

Regression fix with Diego's explicit handoff: the voice HTTP test now clears
`ANTHROPIC_API_KEY` beside `OPENROUTER_API_KEY`. Before: a configured Claude key
consumed its STT→TTS mock and failed the WAV assertion; after: 12/12 focused tests
and the full suite pass with the local credential configured. Network stays mocked.
No production behavior changed.

The runbook correction: audit unlock uses `CONTROLLER_ENROLLMENT_SECRET`,
matching `web/app/api/audit/[action]/route.ts`; the old text named the tool secret.
