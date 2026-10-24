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

Server wiring: build `createRoleRegistry` with real deps and pass the shared `getStateStore()` as `control`. Use `SpacetimeHandoffStore(transport)` in durable mode.

## Office projection (Diego)

Subscribe to `SELECT * FROM agent_handoff_public` (client: `db.agentHandoffPublic`). In-process demos get the
same row shape from `MemoryHandoffStore.subscribe`. Matching `audit_entry` rows use `action` values
`agent_handoff_offered|accepted|completed|rejected`, with the same projection in `inputs`.

| Field | Meaning |
| --- | --- |
| `handoffId`, `sequence` (u64) | Stable id; global order for catch-up |
| `caseDisplayId` | Short case label |
| `fromAgentId`, `toAgentId` | `<role>-agent` |
| `fromRole`, `toRole` | `intake`, `extractor`, `vendor`, `payables`, `collections`, `reconciler`, `auditor` |
| `fromVoiceRole`, `toVoiceRole` | Keys of `orchestrator/src/voice/voices.ts` (`intake_sorter`, `vendor_verifier`, `collections_caller`, …) |
| `status` | `offered` (A walks to B with the folder), `accepted` (B starts), `completed` (B finished its turn), `rejected` (return trip) |
| `correction` | Backward edge (missing evidence / fix request) |
| `reason`, `summary` | Redacted text (no control chars or `<>`, digit runs and emails masked), ≤120 and ≤160 chars |
| `line` | Speech line; POST `{ role: toVoiceRole, text: line }` to `/api/handoff` |
| `createdAt`, `acceptedAt?`, `completedAt?` | ms timestamps (database time) |
| `decisionRef?`, `errorCode?` | Target activation id; rule code on `rejected` |

Packets, artifact refs, documents, contacts and bank data stay in the private `agent_handoff` table.
Animation never commits ownership. A future call-state projection can sit beside this table as its own table.
