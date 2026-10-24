# Orchestrator

Server-side seat workers and model routing. Policy and reducers remain the authority for money, approvals, and state; model results are suggestions.

## Seat worker core

`pnpm --filter orchestrator dev` runs Collections, Payables and Vendor onboarding
against a tiny in-memory scenario, prints agents/tasks and the hash-chained audit,
and exits. All effects are fake. The production policy adapter uses
`@backroom/policy` with typed, trusted Northfield context and cents-based AP
invoice inputs. Tests cover real policy decisions as well as injected outcomes
for concurrency cases, without network or model calls.

`pnpm --filter orchestrator test` runs Vitest. `pnpm --filter orchestrator build`
checks TypeScript. The package entry exports the core without starting a process.
For a long-running service, instantiate one `SeatWorker` per seat and call
`run(abortSignal)`; aborting stops its timers. A failed worker stops, and a
replacement with a **new agent ID** recovers its task after lease expiry.

## Persistence contract

[`src/store.ts`](src/store.ts) is the async SpacetimeDB adapter seam. Its types
mirror spec §4.7; `cursor`, `steps`, `leaseToken` and the payment ledger are
additional durable execution fields. `MemoryStateStore` is a single-process
reference implementation, not durable storage across a complete service restart.

- Claims atomically select a queued task for the seat, enforce one active task
  per seat, increment a fencing token, and enter `working`.
- All task writes require matching owner/token and an unexpired lease. Production
  reducers must use database time and authenticate the caller; the memory store's
  explicit clock is for deterministic tests, not an authorization boundary.
- Heartbeats default to 3 seconds; lease renewal is 12 seconds. Reaping marks
  agents offline after **more than 15 seconds** and requeues expired leases.
  A replacement claim preserves cursor, escalation and idempotency key.
- Escalation insertion precedes `targetAnchor=<human>_desk`. The next server turn
  enters `waiting`; the UI never authorizes movement or effects. The memory store
  intentionally exposes no approval writer. The controller/passkey service owns
  decision writes. A resolved escalation closes the suspended task; any approved
  follow-up effect needs a new task and a fresh policy decision.
- Invoice transitions use expected-current-state checks and the AR/AP state
  graph. They are storage reducers, not model tools. Authentication and policy
  checks must wrap their callers in the real adapter/service.
- `appendAudit` atomically assigns sequence, previous hash and SHA-256 hash, with
  immutable snapshots. Hashing uses the JSON field order emitted by this reference
  reducer; an adapter must preserve the same serialization/order to share a chain.

## Policy and effects

[`src/policy-gate.ts`](src/policy-gate.ts) is the only compatibility adapter for
the policy package. It binds effect kind to action (`call_client`, `run_crs`, `run_apify`,
`pay_invoice`) and evaluates the actual effect input. Producers supply trusted
policy context; raw emails, model text and voice must never construct it.
Each complete decision (ALLOW, DENY, ESCALATE), including exact policy quotes,
is persisted with the proposed action and actual effect input **before** calling an effect.
Payments carry the policy's `APInvoice` under `input.invoice`; its amount is in
integer cents. `Context.policyVersion` guards against a stale saved policy, and
the audit records the actual evaluated version returned by the engine.
An audit-write or policy failure prevents the call. DENY closes the task;
ESCALATE creates evidence and a walk target without executing the effect.

[`src/effects.ts`](src/effects.ts) defines dial/CRS/Apify/Nessie boundaries.
`dial` resolves when the call ends; a real Cartesia adapter must wait for a
completion webhook rather than treating call creation as call completion.
Other integration clients and credentials are intentionally outside this core.
The seat worker core contacts no real service. Model-router live smoke is an opt-in script documented below.

## Payment recovery boundary

One task contains at most one payment. Its nonempty `idempotencyKey` identifies
one immutable payment, including across different replayed tasks. Before the
provider call, `reservePayment` atomically binds the key to a canonical input
fingerprint; conflicting reuse is rejected. Successful receipts are persisted and
replayed without another provider call.

A crash **after the provider pays but before receipt persistence** still requires
the same key at the provider boundary. Real Nessie adapters must durably dedupe
that key (or reconcile the uncertain transfer before sending again), including
across adapter restarts, and return the original receipt. The fake demonstrates
that requirement; the orchestrator alone cannot make a non-idempotent remote API
exactly-once. Nonpayment checks/calls may be retried after a crash. Connect a
durable StateStore and a payment adapter satisfying this contract before claiming
C3 across real process restarts.

## Model router

Cloud routes use the first-party Anthropic Messages API by default and require
`ANTHROPIC_API_KEY`. An OpenRouter key alone never enables cloud calls. The
retained OpenRouter transport is inactive unless explicitly selected with
`LLM_CLOUD_PROVIDER=openrouter` or `cloudProvider: 'openrouter'`.
The default direct model is `claude-sonnet-5-5`. `ANTHROPIC_MODEL=claude-haiku-5-5`
is a cheaper explicit override; both have token-based pricing in
[`src/router/anthropic.ts`](src/router/anthropic.ts). Unknown direct model IDs
fail before spending. `OPENROUTER_*` settings and `cloud*` router options still
configure OpenRouter; `anthropicApiKey` / `anthropicModel` configure the direct
provider. Missing Anthropic credentials fail closed; there is no automatic
OpenRouter fallback. The direct endpoint is fixed so OpenRouter/GX10 base URL overrides
cannot redirect an Anthropic credential. Provider errors fail closed; they do
not trigger a second paid provider request.

Keep the key server-side in repo-root `.env.local`, loaded by the existing
runtime. For Aziz's local machine, import it without printing it:

```sh
# Append only when ANTHROPIC_API_KEY is absent; keep this file gitignored.
printf '\nANTHROPIC_API_KEY=' >> .env.local
security find-generic-password -s backroom-anthropic-key -w >> .env.local
chmod 600 .env.local
```

Do not copy this personal key to the GX10 team env. The opt-in direct smoke
(one call plan and one cited ask-why question, at most three requests) and
usage receipts are documented in
[docs/evidence/anthropic](../docs/evidence/anthropic/README.md).


Import `createRouter`, `route`, and `TaskType` from `./src/router/index.js` (source entry; no bundled package yet). `route(taskType, input, schema?)` returns `{ output, route, model, latencyMs, costUsd }`. Copy the four audit fields onto the model-call audit entry. `latencyMs` includes local attempts and escalation, `costUsd` is zero for GX10 and provider-reported cost or a configurable token-rate estimate for cloud. Missing usage fails closed rather than reporting free cloud inference.

```ts
import { createRouter } from './src/router/index.js';
const router = createRouter();
router.start(); // /v1/models every 10 seconds; unref'ed timer
const result = await router.route('field_extraction', {
  instruction: 'Extract invoiceId and total from invoice. Return {invoiceId:string,total:number}.',
  invoice: 'Invoice INV-1; total USD 42.50',
}, {
  jsonSchema: {
    type: 'object', required: ['invoiceId', 'total'],
    properties: { invoiceId: { type: 'string' }, total: { type: 'number' } },
  },
  parse(value: unknown) {
    if (!value || typeof value !== 'object' || !('invoiceId' in value) ||
        typeof value.invoiceId !== 'string' || !('total' in value) || typeof value.total !== 'number') {
      throw new Error('Invalid invoice');
    }
    return { invoiceId: value.invoiceId, total: value.total };
  },
});
// persist result.route, result.model, result.latencyMs, result.costUsd
router.stop();
```

A Zod schema can be passed directly through its `parse` method. Optional `jsonSchema` supplies model guidance; the parser always decides validity. Without a schema the router validates the `{output,confidence}` envelope only. Input must describe the desired output shape. Code consuming structured finance data should always pass a schema.

| Task type | Preferred route |
| --- | --- |
| `inbox_classification` | Local |
| `field_extraction` | Local, then cloud after two invalid outputs |
| `reconciliation_candidates` | Local |
| `post_call_summary` | Local |
| `call_plan` | Cloud (Claude) |
| `ask_why` | Cloud (Claude) |
| `ambiguous_judgment` | Cloud (Claude) |

In-call conversation is Cartesia's runtime and is deliberately excluded. Confidence below 0.7 escalates immediately; cloud output must also pass confidence and schema checks or the call throws for human review. Confidence is self-reported, not calibrated proof of correctness. Transport errors fall back within the same call. Two schema failures escalate for that call without declaring the host unhealthy.

`router.health()` exposes `{localAvailable,localEnabled,healthyPings,p50LatencyMs}` for the wall's offline banner. HTTP errors, missing configured model, a health ping over 5 s, or the rolling p50 of the last 20 local completions over 5 s disable local routing. A slow successful response is recorded as local; subsequent calls fall back. Three consecutive healthy pings restore availability and clear stale latency samples. Disabled local mode cannot be re-enabled by pings. With `createRouter`, call `start()` explicitly; the convenience singleton `route()` starts its timer lazily.

OpenRouter-only configuration uses existing `GX10_BASE_URL`, `OPENROUTER_BASE_URL`, and `OPENROUTER_API_KEY` environment variables; optional `GX10_MODEL`, `GX10_ENABLED=false`, and `OPENROUTER_MODEL` select models and deliberate cloud-only operation. Defaults: GX10 `gpt-oss:20b`, optional OpenRouter `anthropic/claude-sonnet-4.5`. For cheap cloud development set `OPENROUTER_MODEL=google/gemini-2.5-flash`; update `cloudInputUsdPerMillion` and `cloudOutputUsdPerMillion` when changing models if the provider omits actual cost (default estimates 3/15 USD per million tokens for Sonnet). No key is needed for GX10 beyond the internal non-secret placeholder.

Local calls request reasoning effort `none` for Qwen, `low` for GPT-OSS. Local timeout is 8 s; cloud timeout 30 s. `createRouter(options)` also accepts explicit endpoint/model/key/rate/timeout overrides, plus `fetch` and `now` for deterministic tests. Do not expose this module, keys, or its configuration to browser code.

Pass only the minimum typed fields needed for hard calls. Local failure can send that input to cloud: redact bank details and other unnecessary sensitive fields before calling. An offline or disabled GX10 means the on-site data claim must be dropped. Measured T10 verdict and operational recommendation: [docs/t10-gx10.md](../docs/t10-gx10.md).

## Validation and opt-in live scripts

From the repository root:

```sh
pnpm --filter @backroom/orchestrator test
pnpm --filter @backroom/orchestrator build
# Live GX10 benchmark; overwrites fixtures/t10/results.json, no paid cloud calls
pnpm --filter @backroom/orchestrator exec tsx src/router/measure-t10.ts
# Write gitignored .env.local first with openrouter-env; never print or commit keys
# Live smoke: real GX10 + up to four paid Claude calls; synthetic output/audit metadata
pnpm --filter @backroom/orchestrator exec tsx src/router/demo-fallback.ts
```

The smoke script breaks only its own client endpoint (`127.0.0.1:1`) after ten synthetic scenario calls and asserts `cloud_fallback` on the very next call. It does not stop, restart, or alter the shared GPU server. Network-free Vitest tests cover the task table, schema/low-confidence escalation, same-call fallback, actual/estimated cost, polling/recovery, and cloud-only mode. The smoke receipt records the actual local share including the forced fallback in `fixtures/t10/router-smoke.json`. The UI consumes this API in its own stream; this package does not write the audit wall. The smoke loads a root `.env.local` via an absolute path and skips clearly if the key is absent.

## Global LLM control

Before wiring workers, the office toggle, or a durable adapter, read
[the control contract](../docs/llm-control.md). It defines the shared StateStore,
typed `LLM_OFF` router result, authenticated endpoint, and #15 row mapping.

## C3: kill-the-agent demo

`pnpm --filter orchestrator demo:recovery` runs a four-invoice Payables batch,
SIGKILLs a separate Node worker after payment 2 has reached the simulated provider
but before its receipt reaches the worker, then starts a replacement. It prints
the before/after audit logs and a `PASS recovery` line only after every task is
`done`, all leases are released, and exactly one simulated payment exists per
invoice. Failures exit nonzero. No credentials, browser, network, or models are used.
The parent pins the global model switch OFF for the demo's lifetime; its IPC
worker exposes the corresponding synchronous OFF fields. Recovery and completion
audit entries use `actor=code`. This demo adapter does not subscribe to switch changes.

The parent process hosts the reference StateStore and simulated payment provider;
those services survive the worker crash. The replacement runs the ordinary
`SeatWorker` through a demo-only IPC adapter. It claims expired leases, reads the
persisted cursor and related audit entries, appends `task_resumed` with prior audit
IDs, then reevaluates policy before replay. Audit evidence never authorizes an
effect. Policy/effect entries now include task ID, worker ID, fencing token and
cursor in `inputs`; completion entries also include the payment idempotency key.
The StateStore interface is unchanged.

Configure the demo with environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `RECOVERY_BATCH_SIZE` | `4` | Number of payment tasks |
| `RECOVERY_KILL_AFTER` | `2` | First invoice ordinal to interrupt, starting at 1 |
| `RECOVERY_KILLS` | `1` | Number of successive workers to kill, on successive invoices |
| `RECOVERY_KILL_POINT` | `after_payment` | `before_payment`, `after_payment`, `after_receipt`, or `after_cursor` |
| `RECOVERY_LEASE_MS` | `1200` | Demo lease duration (production worker default remains 12 s) |
| `RECOVERY_HEARTBEAT_MS` | `200` | Demo heartbeat interval (production default remains 3 s) |

For example, `RECOVERY_KILLS=2 pnpm --filter orchestrator demo:recovery` kills two
workers and lets a third finish. Kill points pause after the named service write,
before its response reaches the worker: reservation, provider payment, saved
receipt, or saved cursor. Killing after a saved receipt exercises ledger replay;
killing after a saved cursor resumes completion without replaying that step.

Vitest covers exact lease expiry, stale-owner fencing, audit-linked takeover,
idempotent replay, two consecutive lease losses on the **same payment**, and real
process double kills at all four crash windows. Process tests use the same
simulated services and verify the audit hash chain.

This demonstrates worker-process recovery. It does **not** demonstrate survival
of a parent/state-service restart, production SpacetimeDB persistence, or real
Nessie exactly-once transfers. Those require a durable StateStore and a payment
adapter satisfying the payment recovery boundary above.
