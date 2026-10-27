# SpacetimeDB state backend (#15)

`src/index.ts` is the full §4.7 module. It imports the same deterministic
`ReducerEngine` and policy package as `MemoryStateStore`; external I/O stays in
Node. `SpacetimeStateStore` implements the exported orchestrator `StateStore`
over generated TypeScript client reducers. There is no alternate policy or audit
implementation in the adapter.

Requires Node 22+, pnpm, and **SpacetimeDB 2.13.0** (SDK and CLI pinned together).
T8's original local latency evidence and Maincloud 401 are in
[`docs/t8-spacetime.md`](../docs/t8-spacetime.md). The full-state evidence is below.

## Local setup

```sh
pnpm install
# Install locally if a pinned spacetime CLI is not already available:
mkdir -p .t8-tools
curl -sSf https://install.spacetimedb.com -o .t8-tools/install.sh
sh .t8-tools/install.sh --root-dir "$PWD/.t8-tools/spacetime" --yes

# Separate terminal; durable data unless you explicitly request --in-memory.
.t8-tools/spacetime/spacetime --root-dir=.t8-tools/spacetime start \
  --listen-addr 127.0.0.1:3115 --data-dir .t8-tools/db

.t8-tools/spacetime/spacetime --root-dir=.t8-tools/spacetime publish \
  backroom-local --server http://127.0.0.1:3115 --module-path spacetime --yes
```

Publish records the publisher identity in the private `controller` table. Use
that identity's **private token on trusted servers only**, never in browser props,
`NEXT_PUBLIC_*`, tool arguments, or model input. Anonymous clients can subscribe
but cannot invoke business writers; visual presence is the deliberate exception
documented below. The original T8 spike deferred Maincloud browser authentication
and claimed no hosted publish; that is historical status, not the current host
status. See the [hosted Maincloud parity evidence](../docs/evidence/maincloud-parity/README.md)
and [current demo-host operations](../docs/demo-runbook.md) for later evidence
and the actual host configuration.

Put server settings in the repo root `.env.local`, loaded by the orchestrator
runtime, or supply them in the process environment:

```dotenv
STATE_STORE=spacetime
SPACETIMEDB_URI=ws://127.0.0.1:3115
SPACETIMEDB_DATABASE=backroom-local
SPACETIMEDB_TOKEN=<private publisher token>
```

`STATE_STORE=memory` remains the default. Vitest's process-wide default stays
memory; the contract lane explicitly injects the real reducer harness. Invalid
store names/configuration fail rather than silently falling back. Next server
routes and workers use `getStateStore()` so each process connects to the same DB.
A new durable store starts with models fenced until its subscription and writer
authority are verified. Reads and writes await readiness.

`pnpm state:seed` imports `fixtures/company/northfield.json` through `seed_company`.
It preserves stable IDs, all fixture fields and unprovisioned provider IDs. Repeating
it inserts missing rows without overwriting existing state. The company is synthetic;
these consent records must never authorize a real dial. Publish a fresh DB for each
clean demo; seeding cannot reset completed tasks, approvals, bank changes or audits.

## Tables and subscription contract

All §4.7 tables exist: `policy`, `seat`, `badge`, `room`, `agent`, `human`, `task`,
`escalation`, `inbox_item`, `client`, `ar_invoice`, `payment_plan`, `payment_link`,
`vendor`, `ap_invoice`, `po`, `bank_change`, `call`, `call_turn`, `signal`,
`bank_txn`, `audit_entry`, plus `runtime_control`, private controller/payment
receipts and short-lived operation results.

Typed public projections for the office:

| Table | Fields |
| --- | --- |
| `agent` | `id`, `seatId`, `state`, `room`, `targetAnchor`, `posX/Y/Z`, `heartbeatAt` (Timestamp), optional `currentTaskId`, `modelRoute` |
| `room` | `id`, `name`, `requiredBadge`, `anchors` (JSON) |
| `escalation` | `id`, `taskId`, `fromAgent`, `toHuman`, `status`, `ruleIds`, `evidenceRefs`, `createdAt`, `expiresAt`, `json` (full StateStore row) |
| `audit_entry` | `seq` (u64), unique `id`, `ts` (integer ms), actor/seat/action, ruleIds/policyVersion/refs/route, latencyMs/costUsd, optional decision, canonical `inputs` JSON, prevHash/hash |
| `runtime_control` | `id=global`, `llmEnabled`, monotonic `generation` (u64), `heartbeatAt` |
| `office_presence` | `viewer_id` (random client id, primary key), `name`, `x/z/yaw` (f32), `mode`, `at` (u64 server milliseconds); generated accessor `db.officePresence`, field `viewerId` |
| `policy`, `seat`, `badge` | immutable policy snapshots and current code-enforced badges/limits |

`office_presence_upsert(viewer_id, name, x, z, yaw, mode)` and
`office_presence_leave(viewer_id)` are the **only deliberate anonymous-write
exception**, for optional viewer display. They never touch business state,
permissions or audits. The public row has no SpacetimeDB identity, token or auth
data; private `office_presence_owner` binds each random id to `ctx.sender` so
another identity cannot update or remove it. Only a display name is shared.
Ids must match `[A-Za-z0-9-]{8,64}`. Names lose control characters, are trimmed
and capped at 24 characters, defaulting to `Viewer`. Positions must be finite:
x clamps to [-8,8], z to [-5.5,5.5], yaw wraps into [-pi,pi]. Mode must be
`overview`, `play` or `tour`. Updates within 200ms are ignored without renewing
the timestamp; at most 32 viewers can exist, including when one caller uses
multiple ids. The server alone sets `at`.

A private scheduled table, `office_presence_schedule`, starts one 5s interval
on the first successful upsert, including after updating an existing database.
Its `office_presence_sweep` reducer accepts only the module identity and deletes
public and owner rows older than 15s (removal within 20s of the last heartbeat).
No disconnect hook is installed; TTL handles socket loss. Leave deletes both
rows immediately when delivered. A new anonymous identity reusing a prior
session's viewer id must wait for that row's TTL or successful leave.

The office reuses its existing anonymous connection and subscribes to this table
only when **Show viewers** is enabled (`/office?presence=1` also opts in).
Live mode uses SpacetimeDB when the bindings expose presence; preview and missing
bindings use BroadcastChannel. Presence stays off by default. No additional
connection, browser key, or paid API is needed. Pagehide/close sends leave;
restoring a cached page resumes heartbeats. The web display also prunes stale
peers with the existing 10s TTL and shows at most 12 peers.

`agent.state` includes `paused`; an escalation target is `Dana_desk`. Map that
anchor to the existing office desk. Treasury entry is evaluated against the
**stored seat**, never a caller-supplied badge. `request_room_entry` commits an
ALLOW/DENY audit with action `request_room_entry` and `inputs.agentId/room`; a denial leaves the complete agent row unchanged. Unlike T8's
rollback error, this deliberate denial commits evidence so the red door has a
matching wall entry. `set_agent_target` preserves T8's visual-only API; workers
use `set_agent_target_leased` with fencing.

Private business tables use `{id,json}` with typed state/index columns where
needed (`task`, AR/AP invoices). JSON preserves exported `StateStore` and fixture
shapes without inventing a second domain model. Finance payloads, raw inbox/call
records, payment receipts and passkey credential metadata are not public tables.
The full escalation and audit wall are intended for the synthetic demo office;
they are not a production tenant-authorization system.

Generated bindings live in `orchestrator/src/spacetime-client`, exported as
`@backroom/orchestrator/spacetime-client` and `/spacetime-client/types`.
`web/lib/spacetime` reexports this single schema. After schema edits:

```sh
.t8-tools/spacetime/spacetime --root-dir=.t8-tools/spacetime generate \
  --lang typescript --module-path spacetime --out-dir orchestrator/src/spacetime-client --yes
```

The presence, `set_call_presence`, `agent_escalate_to_human` and
`agent_resolve_human_escalation` binding additions were written in the existing
2.13 generated style because the CLI was unavailable in those worktrees; regenerate
with the same command when the pinned CLI is available. A running database needs a
republish of this module before the host can call those reducers.

Browser example (no token):

```ts
import { DbConnection } from '@backroom/orchestrator/spacetime-client';
const connection = DbConnection.builder()
  .withUri('ws://127.0.0.1:3115').withDatabaseName('backroom-local')
  .onConnect(db => db.subscriptionBuilder().subscribe([
    'SELECT * FROM agent', 'SELECT * FROM room',
    'SELECT * FROM escalation', 'SELECT * FROM audit_entry',
  ])).build();
```

Client accessors use camel case (`db.auditEntry`, `db.runtimeControl`). Safely
convert u64 sequence values to JS integers before canonical audit verification;
the adapter rejects overflow and returns numeric `StateStore` sequences. Do not
hash bigint values as quoted decimal strings. Room positions/anchors are view data;
the renderer grants no authority.

## Reducer contract

Every public StateStore method has a snake-case reducer. These accept
`{requestId,payload}`, where payload is the canonical JSON array of the exported
method's arguments. `setAgentTarget` maps to `set_agent_target_leased`. Server
results are private and exposed only through the identity-filtered
`server_results` view; anonymous clients receive no result rows. The generated
client awaits the reducer result, then acknowledges its temporary receipt.
The adapter does not retry an ambiguous side effect automatically.

- Reducers replace caller time arguments with `ctx.timestamp`. Claims are atomic,
  one active task per seat, with owner/token/expiry/heartbeat checks on mutations.
  Expired agents/tasks are reaped, old owners are fenced, payment fingerprints and
  receipts survive adapter reconnects. Lease duration is bounded to 60 seconds.
- Transition reducers rerun the exported policy binding on persisted tasks and
  actual effect inputs. Invoice transitions also check the persisted agent badge,
  invoice kind and task reference; an out-of-seat invoice write is refused. Current stored vendor
  holds override stale task context. AP approval needs its passkey escalation; AP
  paid needs a persisted payment receipt.
- Business state transitions append `state.<method>` code evidence in the same
  transaction. Heartbeat/renewal timestamps do not add wall noise. Existing
  policy, approval, expiry and payment evidence remains in the same chain.
- `append_audit`/`append_audits` validate input, assign sequence/id/previous hash and
  hash canonical JSON atomically. No audit update/delete reducer exists. Caller
  chain metadata is ignored. Batches roll back entirely. Canonical SHA-256 uses
  the same audited format as [`orchestrator/src/audit/README.md`](../orchestrator/src/audit/README.md).
- `decide_escalation` is trusted-server ingress, protected by publisher identity.
  The adapter consumes the one-use `VerifiedApproval` capability issued by the
  real WebAuthn verifier **before serialization**. JSON/voice cannot mint it.
  The module checks the human, decision, pending status and expiry; no model or
  browser receives that publisher token. SpacetimeDB does not itself run WebAuthn.
- Immutable `record_call`, `record_call_turn`, `record_signal`, `record_bank_txn`,
  `record_payment_plan` and `record_payment_link` ingress supports service adapters.
  Provider turn IDs dedupe globally; stored call identity and the saved policy
  bound plan determine link amounts, with no caller override.
- `seed_company`, `submit_inbox_item`, `verify_bank_change`, `apply_bank_change`
  are trusted-server ingress. A bank change is immutable after verification;
  apply requires bound evidence, an approved passkey escalation, correct policy
  version and unchanged vendor revision. No generic row-update reducer exists.
- `save_policy_limits` uses optimistic version checks and appends the owner audit
  atomically with an immutable snapshot, updating current seat/badge projections.
  Reducers and workers evaluate the latest policy; historical snapshots remain readable.
- OFF and its code audit commit atomically. Subscriptions abort the old model
  signal on OFF, disconnect, stale heartbeat (>5s), or generation change; ON gets
  a fresh signal. A server heartbeat runs each second. Recreate a disconnected
  adapter to reconnect; cached ON never grants model authority.

The StateStore adapter owns tasks, agents, invoices, escalation decisions, payment
receipts, runtime control and audits. `MemoryGatewayStore`, voice call storage,
`MemoryFinanceRepository` and the demo bank remain their explicitly named adapters;
this PR provides their tables and StateStore seam, not an unimplemented claim that
those separate repository interfaces persist automatically. Gateway tests use the
durable shared audit writer; binding complete call/outbox/finance repositories to
these tables remains integration work. The core demo uses fake external services,
scripted call turns and a real software test passkey verifier.

## Verification and parity

```sh
pnpm -r test
pnpm --filter @backroom/spacetime test:contract
SPACETIME_LIVE=1 pnpm state:live
pnpm -r build
pnpm -r typecheck
```

The ordinary module suite runs actual reducers on the SDK's local WASM datastore,
with no network: forged clock, stale leases, cross-badge writes, actual-payment
policy, batch rollback, anonymous writes, seed replay, passkey-bound bank change,
room-denial evidence and disconnect generation fencing.

`test:contract` runs the existing StateStore/audit/real-policy/LLM-OFF/approval/
gateway/core-demo suites through that same module and `SpacetimeStateStore`.
Worker tests that deliberately replace policy with arbitrary mocks remain in the
memory lane; the real-policy worker cases run in both lanes. Test clock control
belongs exclusively to the SDK harness, never to a production reducer argument.

`state:live` is the opt-in real-service lane. It starts its **own loopback server**,
uses an isolated CLI config, publishes six fresh DBs, and shuts its server down.
It makes no model, bank, voice or paid-service request. It verifies:

- Anonymous office subscriptions see Dana's target and all audit rows within 1s;
  anonymous `server_results` stays empty.
- The complete 3D-closed collection loop has identical audit bodies to memory
  replay, modulo timestamps and their derived hashes; both original chains verify.
  Recorded gateway UUIDs are reused so the comparison does not normalize evidence.
- OFF/ON propagates between independent clients and fences old signals. A fresh
  connection reads completed work, and an anonymous writer is refused.
- The actual `STATE_STORE=spacetime pnpm demo:core` command passes the collection, ON/OFF traps, and frozen Northfield AP moments.
  The CLI uses fresh `<database>`, `<database>-on`, `<database>-off`, `<database>-ap` databases to keep
  each demonstration isolated. The live script publishes those names for you.
- Server termination fences model work. Synthetic logs and a small proof JSON are
  saved under ignored `.t8-tools/store-live-*/`.

Local-only evidence does not establish Maincloud deployment, browser DOM latency,
real phone consent, human passkey hardware, or live Nessie reconciliation.
