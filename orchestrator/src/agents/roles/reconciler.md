# Reconciler integration

`createReconciler(dependencies, ctx)` builds the Haiku specialist for one activation.
Pass that specialist to the shared `AgentRuntime.run` once; it supplies only
`read_bank_feed`, `read_payment_receipts`, `request_exact_match`, `record_exception`.
The shared runtime adds `handoff` and disables built-ins. This module never calls a
provider itself, chooses a credential, starts a recipient, or constructs a lease.

The trusted host implements `ReconciliationDependencies.loadCase(ctx)` from the
current case ledger. It supplies the exact invoice artifact, invoice ID, expected
amount/memo, current state, bank account and existing Collections task lease.
For a payment link the amount is the authorized installment amount. Optional
`payments` binds the existing `PaymentService`; optional `finance` binds the
existing `FinanceRepository` for Nessie/x402 Payables receipts. Neither is a tool
argument. No model-provided account, invoice, approval, amount or key is accepted.

Before each activation, load the persisted `correctionReturns` count. The host's
atomic handoff acceptance increments it on reconciler → collections, and rejects
any return after two. Build a fresh specialist on every activation: at two returns
its `allowedNext` excludes Collections. Tools reread that count, so missing-proof
results also route to Auditor after the bound. The shared dispatcher must retain
its own persisted correction/total activation bounds; tool suggestions do not
commit ownership.

Tool output `artifactRefs` includes the existing invoice ref and the persisted
code audit ID. Register/resolve those audit IDs as private case evidence before
accepting a handoff. `read_payment_receipts` projects trusted receipts only; an
x402 testnet receipt cannot stand in for a Nessie deposit or clear an AR claim.
`request_exact_match` re-fetches deposits and uses existing deterministic
`matchRemittance`/`reconcileAlreadyPaid` or `PaymentService.reconcile`. Partial,
ambiguous, pending and mismatched deposits stay exceptions. A correctly matched
authorized installment can become `partially_paid` through PaymentService.

Missing proof requests Collections follow-up; other exceptions go to Auditor.
Only existing payment-link reconciliation creates its existing controller review.
`record_exception` persists a code rule receipt; model prose stays out of the
public audit. Audits contain identifiers and code summaries, never raw documents
or bank destinations. A store wrapper checks activation currency around every
legacy reconciliation store operation; reducers retain lease checks and payment
idempotency. Existing multi-operation reconciliation is not made atomic by this
wrapper, so the host must retain the existing receipt recovery path.

Offline verification: `pnpm --filter @backroom/orchestrator test src/agents/tools/reconciliation.test.ts`.
No live model smoke is required. This role has no independent SDK/runtime loop.
