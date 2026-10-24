# Auditor integration

`runAuditor(runtime, ctx, input, deps)` runs one Haiku query with the shared
`AgentRuntime`. It exposes only `read_audit`, `verify_chain`, `get_receipt`, and
`record_case_summary`; core adds its restricted `handoff` tool. No SDK/provider
implementation or credentials belong to this role. Tests use a mock runtime;
no live provider calls were made (live `total_cost_usd`: $0).

Bind `AuditDependencies` on the server:

- `store`: the existing StateStore. The role's type exposes reads plus append-only
  audit recording, with no payment, approval, vendor, or task mutation methods.
- `loadCase(caseId)`: trusted case-specific invoice/task refs and the **persisted**
  correction count. Never use a shared vendor ref as case membership or obtain
  refs/counters from model input. Increment the count atomically with accepted
  correction transfers in the host's handoff store; do not reset it per query.
- `loadReceipt(receiptId)`: optional trusted receipt-archive/provider read for
  PayablesSeat's `nessie_completed` / `x402_testnet_completed` receipt ids. It must
  retrieve actual evidence; copying an id from an audit is not receipt verification.
  Missing archives hold the case. Worker-task receipts use `getTask`/`getPayment`
  and the task's server-owned idempotency key instead.

The core runtime owns SDK built-in exclusion, current lease/generation checks,
Keychain child credentials, cost receipts and budgets. Each Auditor handler also
checks its server-authored role, cancellation, and `ctx.assertCurrent()` before
reading and before exposing/recording a result. Keep the existing guarantees in
`docs/llm-control.md` and `worker.ts`.

`runAuditor` validates a returned correction before the dispatcher can commit it,
and refuses `done` without this activation's recorded summary. If a host uses
`createAuditor` directly, call `validateAuditorCorrection(ctx, request, deps)`
immediately before committing an Auditor handoff. It requires the exact missing
item in `reason`, its real audit id in `artifactRefs`, the responsible destination,
and fewer than two persisted correction returns. Pure chain corruption / absent
case audits have no attributable prior action; they remain held for investigation.
The host must still validate ownership/artifact existence and commit atomically.

Auditor checks all case `pay_invoice` ALLOW decisions, completed Nessie/x402
records, and uncertain payments. Completion requires an earlier matching code
ALLOW; all such money records need a real policy snapshot and completed receipt.
Routine ALLOW decisions need no human approval. When a money audit/task references
an escalation, the stored approval must be an approved passkey decision, bound to
this case and policy and recorded before the action within its approval window.
This is a historical evidence check, never a new payment authorization.

The append-only `case_summary` audit action is the wall artifact. Its `inputs`
contain `caseId`, server-authored `role: auditor`, short `summary`, real
`citations`, and `activationId`; refs include the case id and cited audit ids.
`seat: controller` is the existing audit schema category, not an approval grant.
The role gets no new policy badge. The existing AuditWall displays the summary and citations under Recorded inputs.
Office renderers must keep summary text escaped as untrusted text. This worker changes neither the office nor SpacetimeDB schemas.
Repeated identical recording within an activation returns the same summary;
conflicting content is denied. SDK costs remain in the runtime usage receipt,
not the summary audit's zero-cost write metadata.
