# Seat worker core

`pnpm --filter orchestrator dev` runs Collections, Payables and Vendor onboarding
against a tiny in-memory scenario, prints agents/tasks and the hash-chained audit,
and exits. All effects are fake. The production policy adapter uses
`@backroom/policy`; while that package is the deny-all stub, the demo honestly
shows three denials. Tests inject policy outcomes to exercise allowed effects
and escalations without network or model calls.

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
policy #11. It binds effect kind to action (`call_client`, `run_crs`, `run_apify`,
`pay_invoice`) and evaluates the actual effect input. Producers supply trusted
policy context; raw emails, model text and voice must never construct it.
Each decision (ALLOW, DENY, ESCALATE) is appended **before** calling an effect.
An audit-write or policy failure prevents the call. DENY closes the task;
ESCALATE creates evidence and a walk target without executing the effect.

[`src/effects.ts`](src/effects.ts) defines dial/CRS/Apify/Nessie boundaries.
`dial` resolves when the call ends; a real Cartesia adapter must wait for a
completion webhook rather than treating call creation as call completion.
Other integration clients and credentials are intentionally outside this core.
No real service is contacted, so there is no live-network smoke script here.

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
