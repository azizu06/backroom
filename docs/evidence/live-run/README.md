# Phone-free live rehearsal (Refs #29 #32)

Receipts in `2026-10-24T09-20-39.386Z/` were captured on October 24 with a real
local SpacetimeDB 2.13.0 server started by `pnpm demo:up`, exported core/gateway/
StateStore APIs, GX10 inference through the shared router, and live Nessie sandbox
reads/deposit reconciliation. Each phase uses a fresh owned database on that same
server; the web host's separate bank remains explicitly mock. This does not prove
the phone → browser controller → bank integration or hosted/Maincloud operation.

## Reproduce

Install the pinned CLI per `docs/demo-runbook.md`, retrieve `.env.local` privately,
and check `gx10 gpu`. No OpenRouter or Cartesia request is made by this script.

```sh
STATE_STORE=spacetime DEMO_TUNNEL=0 DEMO_PORT=3337 DEMO_STATE_PORT=3137 pnpm demo:up
DEMO_STATE_PORT=3137 pnpm demo:live --confirm-sandbox
SPACETIME_CLI="$PWD/.demo/spacetime/spacetime" SPACETIME_ROOT="$PWD/.demo/spacetime" pnpm demo:parity
pnpm metrics --audit docs/evidence/live-run/2026-10-24T09-20-39.386Z/collections.audit.json --audit docs/evidence/live-run/2026-10-24T09-20-39.386Z/inbox.audit.json --audit docs/evidence/live-run/2026-10-24T09-20-39.386Z/off.audit.json
pnpm demo:down
```

Use the fresh audit paths printed by `demo:live` for a new take. Preserve the
Nessie Claims directory across reruns; never erase a reservation or retry an
ambiguous bank POST directly. Custom CLI installation paths use `SPACETIME_CLI`
and `SPACETIME_ROOT`. `DEMO_STATE_PORT` must match the running demo supervisor.

## What these receipts establish

- Moment 1: scripted identity/call turns, code denies fee waiver, escalates four
  installments, verifies a software test WebAuthn denial, authorizes two payments,
  and reconciles the exact $2,475 sandbox deposit into `partially_paid`.
- The saved take reuses the existing invoice/installment deposit idempotently.
  Its posted-deposit display is 248100 → 248100 cents; it is not new money or
  settlement. The gateway stores and finance repositories remain memory adapters.
- Moment 2: actual model classification/extraction of JSON-encoded frozen invoice fixtures precedes the #4419 bank-change
  hold and #4471 lookalike + bank-change hold. Typed #4471 separately exercises the
  SeatWorker with zero bank effects, both ON and OFF. OFF raw invoice input takes
  the deterministic `INVALID_INPUT` hold; it does not claim successful extraction.
- Moment 3: after two initial outputs supplied only a citations array, explicit
  inline-citation guidance produced a validated model answer. The successful why
  retest was appended to the same collection DB without replaying bank work; the
  receipt records its time. Invalid earlier answers are excluded from completed
  decision metrics, so those metrics omit failed requests/retries and are not a
  total elapsed-time or cost benchmark.
- Six completed audited model decisions: one call plan, four inbox calls, one why.
  Hard tasks use `gpt-oss:120b`; extraction uses `gpt-oss:20b`. An explicit rehearsal
  override points every transport to GX10 and prevents cloud requests. This 100%
  local sample does **not** establish production routing policy C2 attainment,
  successful cloud fallback, or cloud quality. Zero API cost excludes hardware,
  power, telephony, and failed/rejected work.
- LLM OFF returns code templates and holds; no model decisions occur in its chain.
  Parity proof and headless screenshots are in `../parity/`.

CRS and Apify remain fake, the caller and card interaction scripted, and the
passkey authenticator software. No phone was dialed. Voice latency, real human
approval workload, full final-state answer-key match, trap/false-hold rates and
speech/commitment compliance remain unmeasured. The two inbox examples are
bounded demonstrations, not the full §7.2 trap-rate denominator.

## Integration fixes found

The router's schema guidance described the bare task output after asking for an
`output`/`confidence` envelope. The live quality model followed that bare schema,
so the strict decoder rejected a policy-valid plan (`Invalid model envelope`).
The router now supplies a complete envelope schema; validation remains strict.
The core failure includes the pre-call status, reason and stop rules.

Ask-why also needs the inline citation syntax at the answer field and correction
step. Its existing citation validator caught the initial responses and returned
code evidence; the revised guidance produced the cited live answer. Network-free
regression tests cover both request contracts and preserve OFF behavior.
