# Agent runtime and handoffs

Seven role agents, each with one responsibility, hand a case to one another. Code lives in
`orchestrator/src/agents/`. Contracts are in `contracts.ts`. Design sources are the
Claude Agent SDK GO spike and the A2A framework report (§5–7).

## Pieces

| File | Owns |
| --- | --- |
| `runtime.ts` | `ClaudeAgentRuntime`: one fresh Claude Agent SDK `query()` per activation. Settings: `tools: []`, the full `BUILTIN_TOOL_NAMES` deny list, `settingSources: []`, `persistSession: false`, `permissionMode: 'dontAsk'`, a catch-all PreToolUse allow-name hook, `maxTurns` 10 and `maxBudgetUsd` from `usage.ts`. The child env is explicit (temporary HOME/config and the activation's key only). The runtime consumes the full stream and keeps only the latest cumulative result. Absent or zeroed cost is recorded as `NaN` (unknown) and charged at the full reservation. |
| `tools.ts` | `DomainTool` → SDK `tool()`, plus one `createSdkMcpServer` per activation holding only that role's tools and `handoff`. Each wrapper checks the seal, re-parses the full zod schema and calls `assertCurrent()` before and after `execute`. Refs that code returns (`ref`/`*Ref`/`refs`/`*Refs` fields of a tool output) become citable; model arguments never do. |
| `handoff` tool | Validates the target against `allowedNext` ∩ graph and the refs against what the role was given or its tools returned. It stages one offer and **seals** the activation: later tool calls are refused. The query drains (abort after 10 s). Only the dispatcher commits. |
| `dispatcher.ts` | Keeps one active role per case. For each step it gates on OFF, cancellation, the 120 s case timeout and the activation limit, then starts a fenced activation, builds the role's specialist, reserves budget, runs, and settles. It then applies the role's `beforeCommit` guard and commits through the store. A non-terminal role that stops without a handoff, a guard rejection, a refused commit and a code hold all end the case as `held` for a human. |
| `handoff-engine.ts` | Pure state machine shared by memory and SpacetimeDB: allowed graph, correction bound (2 per case), activation bound (10), terminal roles (`auditor`, `collections` opt-out), dedupe per source activation, lease fencing, the public projection and handoff audits. |
| `handoff-store.ts` | `AgentCaseStore` with two implementations: `MemoryHandoffStore` (process-local, `subscribe()` feed) and `SpacetimeHandoffStore` (the `agent_*` reducers). |
| `usage.ts` | One ledger per credential owner (`FileUsageLedger` at `.env.agents/usage-ledger.json`, cross-process lock). It warns at $25, stops ordinary runs at $35, lets `mode: 'demo'` use the reserve, and hard-stops at $40. Per activation: Haiku $0.02, Sonnet $0.08. Per case: $0.30 dev, $0.50 demo. |
| `roles/index.ts` | `createRoleRegistry(deps)`. Each role is a `RoleModule` (`specialist`, optional `run`, `beforeCommit`, `evidenceRefs`, `afterCommit`). A role without deps is not registered, and its cases hold as `ROLE_NOT_REGISTERED:<ROLE>`. |

Allowed graph: intake→extractor; extractor→vendor/payables/intake; vendor→payables/extractor;
payables→auditor/extractor/vendor; collections→reconciler; reconciler→auditor/collections;
auditor→any role already in the case. Backward edges count as corrections.

Role guards wired in the registry:
- Vendor: `assertVendorHandoff`, and `human_review` becomes a hold.
- Auditor: `validateAuditorCorrection`, plus `runAuditor`'s summary check. Its audit ids are citable evidence, and its `correctionCount` comes from `auditorCorrections(state)`.
- Intake: `runIntakeActivation`.
- Collections: `runCollectionsPostCall`.
- Reconciler: the host's `loadCase` supplies `correctionReturns(state, 'reconciler', 'collections')`.

## Running it

```sh
pnpm --filter @backroom/orchestrator demo:agents            # mocked, no network, $0
pnpm --filter @backroom/orchestrator demo:agents -- --live  # Claude chooses; Keychain key, ~$0.01
```

The demo runs two chains:
- AP: intake → extractor → vendor → payables → auditor.
- AR: collections → reconciler → auditor.

It uses the merged role modules on synthetic Northfield fixtures, with a fake GX10, bank, CRS and Apify. The reconciler is a stand-in: the real one binds the host's Collections task lease (`roles/reconciler.md`). The live key comes from macOS Keychain service `backroom-anthropic-key` and goes into the child env only.

## Judge inbox host

Signed-in operators can press **Start the workday** in the Inbox or office corner
menu. `/api/operator/workday` feeds three frozen Northfield invoice presets
(4401, 4481, 4482), then a lookalike bank-change email, 2.5 seconds apart through
the existing inbox handler and narration host. The attack also runs the existing
Attack assessment in `mock` mode (code checks, no paid analyst). Invoice intake
uses a server-only hold adapter: it calls `PayablesSeat.assess`, never payment
execution, even when the host has a live bank configured. Narration already has
no payment port. Vendor/CRS guards still apply to the email.

The producer runs once per company reset, shares the host's ledger and demo case
caps, and requires headroom for all remaining $0.50 case budgets below the $40
hard stop. OFF refuses new work; reset aborts the producer and existing agents.
A repeat returns the current running/done/stopped receipt without resubmitting.
The local `$0` rehearsal is `pnpm --filter @backroom/web build` followed by
`pnpm --filter @backroom/web exec playwright test --config tests/workday.config.ts`.
It starts its own ports 3057/3058 and uses a scripted QueryFn with real tools,
guards and public rows; it also verifies overlap through the office walk planner.


`web/lib/demo/agents.ts` wires the production `Dispatcher`, `ClaudeAgentRuntime` and
`createRoleRegistry` into `/api/inbox` after its deterministic decision is recorded.
It defaults ON under `BACKROOM_DEMO=1`; `DEMO_AGENTS=0` disables narration for an
offline rehearsal. Other hosts require explicit `DEMO_AGENTS=1`. The shared
StateStore remains the OFF/generation control, including in-flight cancellation.

Recognized documents enter intake → extractor → vendor → payables → auditor,
subject to each role's existing hold/correction guards. Unrecognized documents
hold at intake. Intake keeps `source: judge`; only this trusted narration host
opts into judge extraction. Extractor revalidates the router candidate already
recorded in the immutable inbox audit and cites that receipt. It cannot alter the
fields, re-upload bytes or trigger another unledgered cloud fallback. The inbox's
original router still chooses local/GX10 or cloud extraction as before.

Payables has a policy-only assessment port and a separate hold-only request port:
even ALLOW cannot pay. Controller access only requests review; no approval writer,
bank adapter or voice dialer is supplied. Vendor checks use the configured CRS
client with fixture-owned identity mappings; unmapped/unavailable identities hold.
Paid Apify checks have zero narration allowance and report `skipped_budget`.

SpacetimeDB mode shares the demo runtime's exact transport and publishes rows to
`agent_handoff_public`. The office subscribes to that table (`OFFICE_QUERIES` in
`web/lib/office/spacetime.ts`) and its handoff stage walks the sender to the receiver's
desk from those rows (`web/lib/office/live-handoff.test.ts`). Memory mode exposes the same row
shape through `MemoryHandoffStore.subscribe`; without SpacetimeDB the office shows its
walkthrough state and is not connected to that host feed.
The Mac host reads its own `ANTHROPIC_API_KEY` at activation time. No key is copied
to GX10 or a team env file. The repo-root `FileUsageLedger` persists across reset:
$0.50 per demo case, $0.02 Haiku/$0.08 Sonnet activation reservations, $40 hard stop
($25 warning; demo may use the $35–$40 reserve). Reset/stop aborts and fences open
cases with `DEMO_RESET`, drains queries, then replaces the StateStore/transport.
If the dispatcher already made a case terminal between reset's read and stop,
reset confirms that state and continues; storage failures remain retryable.
Narration failures cannot replace or delay the recorded inbox HTTP response.

### Live collections calls

When the voice relay reports a call ended (`/__demo/voice-call-ended`), the same host
runs the AR chain collections → reconciler → auditor on the gateway's recorded call
(`submitCallOutcome`, once per call) with the same OFF switch, ledger and `mode: 'demo'`.
Stops and pending approvals stay code-owned holds with no handoff. The reconciler holds
a fresh Collections task lease (`demo:agent-reconciler`) on the host's claim queue only
for its own activation.

During the call, `voice:collections` is `on_call` from registration until the call ends
(`setCallPresence`, pulsed every 5s and on each gateway tool call), keeps walking to
Dana's desk while her decision is pending, and is `idle` after. Each policy escalation
is published code-side through the shared handoff store (`escalateToHuman`, case
`call:<callId>`) as one `collections → human` row: `offered` while Dana decides,
`completed` on a passkey approval, `rejected` (`DENIED`, `COUNTER_OFFER`,
`ESCALATION_EXPIRED`, `PENDING_OWNER`) otherwise. No model or role can write that row.
Projection failures are logged and never change a tool result or call end.

Verification (mocked QueryFn; no paid calls):

```sh
pnpm --filter @backroom/web exec vitest run lib/demo/agents.test.ts lib/inbox/http.test.ts lib/demo/runtime.test.ts
pnpm --filter @backroom/web test:agents:state # real agent_* reducers on local WASM; office rows
```

The full five-role mocked case reports **$0.002** in synthetic SDK receipts
(5 × $0.0004); actual provider spend is **$0**. This is accounting evidence,
not a live-provider cost measurement.

## Office projection contract (Diego)

To connect the pending office consumer, subscribe to `SELECT * FROM agent_handoff_public` (client: `db.agentHandoffPublic`). In-process demos get the
same row shape from `MemoryHandoffStore.subscribe`. Matching `audit_entry` rows use `action` values
`agent_handoff_offered|accepted|completed|rejected`, with the same projection in `inputs`.

| Field | Meaning |
| --- | --- |
| `handoffId`, `sequence` (u64) | Stable id; global order for catch-up |
| `caseDisplayId` | Short case label |
| `fromAgentId`, `toAgentId` | `<role>-agent` |
| `fromRole`, `toRole` | `intake`, `extractor`, `vendor`, `payables`, `collections`, `reconciler`, `auditor`; `toRole` is `human` (Dana's desk, `toAgentId` `human:Dana`) for a live-call escalation |
| `fromVoiceRole`, `toVoiceRole` | Keys of `orchestrator/src/voice/voices.ts` (`intake_sorter`, `vendor_verifier`, `collections_caller`, …) |
| `status` | `offered` (A walks to B with the folder), `accepted` (B starts), `completed` (B finished its turn), `rejected` (return trip) |
| `correction` | Backward edge (missing evidence / fix request) |
| `reason`, `summary` | Redacted text (no control chars or `<>`, digit runs and emails masked), ≤120 and ≤160 chars |
| `line` | Author’s speech line; while `offered`, POST `{ role: fromVoiceRole, text: line }` to `/api/handoff` |
| `createdAt`, `acceptedAt?`, `completedAt?` | ms timestamps (database time) |
| `decisionRef?`, `errorCode?` | Target activation id (escalation id for a `human` row); rule code on `rejected` |

Packets, artifact refs, documents, contacts and bank data stay in the private `agent_handoff` table.
Animation never commits ownership. A future call-state projection can sit beside this table as its own table.
