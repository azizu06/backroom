# M7 payments and reconciliation

`/pay/[linkId]` uses `GET /api/pay/[linkId]` and same-origin `POST` with exactly `{}`.
No amount, invoice, installment, model text or card details are accepted from HTTP.
`authorizedPaymentLink` checks the gateway link against its stored plan and original
`propose_plan` ALLOW audit. The current gateway issues installment 1 links only.
Second-installment authorization must come from a trusted future plan/link writer;
`PaymentService` already reconciles sequential installment receipts.

The page displays **Nessie = sandbox bank; simulated card.** Its balance is the
unchanged `readBalanceWithPostedDeposits()` result and exact API label:
**Nessie account balance + Nessie-reported posted deposits**. Components are shown
separately. This is neither available funds nor settlement evidence. The sandbox's
account balance does not move; T4's original balance-increase gate remains unmet
([observations](t4-nessie.md)). A completed feed match is an invoice-ledger match.

## Server setup

Set server-only `NESSIE_API_KEY`, `NESSIE_ACCOUNT_ID`, `NESSIE_CLAIMS_DIR`. The account
must already exist. All writers to that account, including CLI processes, must use
one durable/shared Claims domain; ephemeral per-instance directories are unsafe.
The default web bootstrap leaves posted payments pending for the orchestrator job.
Unknown/unconfigured links cannot pay. No seed creates a live authorization.

`getPaymentService()` / `installPaymentService(service)` are trusted bootstrap seams.
Gateway adapters may implement optional `findPaymentCall(linkId)`; the reference
MemoryGatewayStore implements it. Install a common payment service/queue alongside
the gateway and StateStore adapters for the live deployment. `onPosted(linkId)` can
schedule or run a job; a job failure preserves `pendingPayments()` for retry.

The orchestrator job calls:

```ts
await payments.reconcile(linkId, stateStore, invoiceTaskLease, currentInvoiceState);
```

The lease's task must carry `idempotencyKey=ar:<invoiceId>:<installment>`.
The job reads Nessie's feed, requires a unique completed balance deposit with the
exact invoice/installment memo, receipt ID and cents, then uses StateStore's
`transitionInvoice` and receipt reducers for `partially_paid` / `paid`.
Earlier installment amounts come only from stored reducer receipts.
The host owns task scheduling, heartbeat renewal and task completion; payment HTTP
never claims another collections worker's task or writes invoice state.
`pnpm demo:core` and the offline page rehearsal wire this job end to end.

`exceptions()` contains short (`RECON_SHORT`, email followup), duplicate
(`RECON_DUPLICATE`, Dana refund/credit review), fuzzy/unmatched and uncertain
payments. Duplicate/fuzzy cases create a shared Dana review escalation; refunds and credits require a separate human action. Reconciliation exceptions are also appended to the shared audit chain.
A claimed prior payment uses `reconcileAlreadyPaid` with a **trusted ledger memo**;
a matching amount or the client's speech cannot clear an invoice. It creates no
deposit. `inspectPaymentEvidence` can use an explicit trusted import link reference
to classify short/duplicate exceptions; that reference never substitutes for the
exact memo required to clear money. No fuzzy model is needed or called.

The current service queue is process-local, matching the gateway reference adapter.
Do not deploy across independent web/orchestrator processes until #15 persists this
queue and installs common adapters. Invoice transition and receipt writes currently
use separate StateStore calls: an interruption between them fails closed for manual
review on CAS failure; this is not an atomic settlement transaction. Nessie's durable
claims prevent re-POST on an ambiguous response or a process restart. Fractional-dollar
payments are refused before posting because the sandbox truncates them.

## Rehearsal and verification

- `BACKROOM_PAYMENT_DEMO=1 pnpm dev:web`, then `/pay/payment-demo-1042`: Tomi's
  synthetic 1042 receivable, real gateway/policy, SDK over fake bank HTTP, real
  leased reducer reconciliation. No model, phone call or live bank request.
- `pnpm demo:core`: same exported payment service/job; 3D closed, external HTTP fake.
- `pnpm demo:core --live`: the one opt-in core payment live path. Loads root
  `.env.local`, uses the merged Nessie client and shared `.nessie-state/claims`
  (or `NESSIE_CLAIMS_DIR`), and can seed a sandbox account if no account ID is set.
  The existing Nessie package live script remains its low-level service probe.
- `pnpm --filter @backroom/orchestrator exec vitest run src/payments src/core-demo`:
  network mocked; amount, memo, idempotency, partial/full receipts and seed
  C06/C07/C19/C20. Answer-key signoff is still pending; this is not eval run #1.
- `pnpm --filter @backroom/web exec playwright test --config playwright.payments.config.ts`:
  headless mobile pay + reload, desktop screenshot, unknown link rejection. PNGs
  live under gitignored `web/test-results/` and are attached to the delivery PR.
