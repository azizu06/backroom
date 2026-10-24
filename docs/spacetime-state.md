# Full SpacetimeDB state: local evidence

Verified 2026-10-24 around 01:48 PDT, after integrating main through `bb63766`.
This extends the original T8 spike; it does not replace its historical evidence.
Setup, table visibility, reducer signatures and UI subscription mapping are in
[`spacetime/README.md`](../spacetime/README.md).

The module publishes on a real local SpacetimeDB 2.13.0 standalone server. The
opt-in lane starts and terminates its own loopback instance, uses a private
per-run CLI config, and publishes fresh databases. No cloud model, phone, sponsor
API, bank or paid service is contacted by this lane.

| Check | Observed result |
| --- | --- |
| `pnpm -r test` | 445 passing at the integrated candidate |
| `pnpm --filter @backroom/spacetime test:contract` | 84 existing state/audit/real-policy/recovery/LLM-OFF/approval/gateway/core-demo/policy-editor tests pass through actual WASM reducers and the durable adapter |
| `pnpm --filter @backroom/spacetime test` | 14 module tests pass, including database-time fencing, cross-badge writes, AP approval/receipt requirements, stale vendor context, fixture seed replay and FIFO claims |
| `pnpm -r build`, `pnpm -r typecheck` | Pass, including `/office`, `/audit`, `/t8` and generated client reexports |
| `tsc --project spacetime/tsconfig.tests.json --noEmit` | Scripts and test-harness types pass |
| `SPACETIME_LIVE=1 pnpm state:live` | Pass on actual standalone server and generated WebSocket client |
| Anonymous office subscription | Saw Dana target and all 31 collection audit entries; maximum local row-to-client callback latency **4 ms**; server result view remained empty |
| Collection audit parity | All **31** audit bodies equal memory replay; only timestamps and their derived hashes differ; both original hash chains verify |
| Cross-client model switch | OFF aborts the peer's old signal, ON creates a fresh signal, old generation remains fenced |
| Owner policy save | Immutable v1 stays readable; v2 and its owner audit commit atomically; subsequent reads see v2 |
| New client after close | Reads completed task and verifies the persisted chain |
| Anonymous writer | Rejected with `CONTROLLER_REQUIRED` |
| Canonical company seed | Loaded through the real reducer; repeating it creates no extra seed event or duplicate invoice |
| Actual CLI | `STATE_STORE=spacetime pnpm demo:core` passes collection, ON/OFF bank-change traps and frozen Northfield AP demo |
| Server shutdown | Adapter models become disabled and signal aborted |

The live script replays recorded successful StateStore calls through the public
memory adapter, including original gateway UUIDs and public test credential IDs.
It compares canonical audit bodies after removing only `ts`, `hash`, `prevHash`;
it does not rename IDs, discard inputs or normalize decisions. Full chain
verification runs separately on both original chains.

Generated receipt responses preserve numbers. Audit sequences are stored as u64
and converted only when they fit JS safe integers. Business transition evidence
commits in the same reducer transaction; no audit update/delete reducer exists.
Operational heartbeat/renewal timestamps do not add audit noise. Expected business
errors are translated to `SenderError` instead of becoming opaque runtime faults.

Maincloud remains deferred: T8's local-only token produced 401 `InvalidSignature`,
and browser login is still needed. No new hosted attempt or hosted latency is
claimed. The 4 ms result measures local client callbacks, not DOM commit or a
networked venue deployment. The office can consume the public tables through the
new shared bindings; its `OfficeState` producer still needs that integration.

`MemoryGatewayStore`/local voice call persistence and `MemoryFinanceRepository`
remain separate explicit adapters. Their full call/outbox/finance transactions do
not silently become durable by choosing a StateStore. This change supplies their
schema, guarded ingress and shared StateStore; live model, phone, hardware passkey
and external finance gates remain their owning integrations.
