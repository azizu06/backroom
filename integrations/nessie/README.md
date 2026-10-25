# Nessie = sandbox bank

Server-only `@backroom/nessie` workspace package. Separate from the orchestrator so
M7 (#21) and seed tools consume the same exported API without touching active
seat/router/voice streams. Add `"@backroom/nessie": "workspace:*"` to a server
consumer's dependencies. No real money moves.

```ts
import { FileClaims, NessieClient, seedNorthfield } from '@backroom/nessie';

const claims = new FileClaims('/persistent-shared-volume/nessie-claims');
const bank = new NessieClient({ apiKey: process.env.NESSIE_API_KEY!, claims });
const { account } = await seedNorthfield(bank, claims);
const before = await bank.readBalance(account._id);
const deposit = await bank.deposit({
  accountId: account._id, invoiceId: '1042', installment: 1, amountCents: 240000,
});
const after = await bank.readBalance(account._id);
const feed = await bank.listTransactions(account._id);
// Reconcile amount + memo + actual bank balance in code before changing invoice state.
```

Exports: `NessieClient`, `FileClaims`, `Claims`, `NessieError`, `seedNorthfield`,
`paymentMemo`, `withdrawalMemo`, `SANDBOX_LABEL`, `POSTED_DEPOSITS_LABEL`, `PostedDepositsDisplay`, and typed customer/account/payment/transaction
inputs and results. Customer/account create/get/list methods are available.
`readBalance` returns the provider's balance in dollars; `amountCents` is integer
cents and converts at the boundary. **The current API truncates fractional dollar
amounts, so the client rejects cents not divisible by 100 before any request.**
Never silently round a permitted plan amount.

**T4 FAIL:** deposits persist but the current hosted API does not increase the
account balance. See [live evidence](../../docs/t4-nessie.md). A pending→completed transition also left balance at zero; see the follow-up
status/purchase/transfer probes in the evidence. Returning a deposit
is a receipt, not evidence of settlement. M7 must keep the invoice unresolved and
surface an exception if the bank balance does not reflect the amount. This package
does not fabricate a balance or implement a mock bank. Display `SANDBOX_LABEL`
wherever this data is shown; the pay page also needs “simulated card.”

## R13 retries

GETs retry transient network errors, 429 and 5xx (three bounded attempts by default).
POSTs are never blindly retried. `deposit` checks the unique invoice/installment
memo, reserves a durable claim **before** POST, and scans deposits after an
ambiguous response. An existing memo with a different amount or duplicate rows
raises an exception. An absent deposit with an existing claim remains uncertain;
retries cannot POST again. Seed creation uses the same reservation mechanism.

All processes that write an account **must share the same durable Claims backend**.
`FileClaims` uses exclusive file creation and fsync; use a persistent shared volume
with atomic exclusive creation, or implement `Claims` with a database unique key.
Do not use separate claim directories per worker, erase claims, or issue direct
POSTs outside this client. A crash before POST sacrifices availability: leave the
claim reserved until an operator reconciles it. Claims never expire automatically.
Raw `createCustomer`/`createAccount` methods do not promise idempotency; use
`seedNorthfield` for the seed workflow.

## AP sandbox withdrawals

`withdraw({ accountId, vendorId, invoiceId, amountCents })` posts a completed balance withdrawal
to the configured Nessie sandbox account. The memo is the code-owned
`backroom:ap_vendor=<vendorId>:invoice=<invoiceId>`; callers cannot replace it. It scans the withdrawal
feed before POST, reserves `withdrawal:<account>:<memo>` in the same durable Claims
domain, never blindly retries a POST, and recovers the exact feed row after an
ambiguous response. A conflicting amount, cancelled row, duplicate memo, or reserved
but absent row fails closed. The integer-only sandbox still requires whole dollars.

`reconcileWithdrawal(request, debitId)` performs a fresh withdrawal-feed read and
returns `EXACT` only when one row has the same debit ID, memo, amount, `balance`
medium and `completed` status. `MISMATCH` is evidence for controller review, not a
successful payment. `@backroom/orchestrator` exports `nessieDebitPayables` to bind
this client to `PayablesSeat`; the configured source account is `NESSIE_ACCOUNT_ID`.
This is simulated sandbox money only, never a production bank rail.

`readBalanceWithPostedDeposits(accountId)` is an explicitly selected sandbox display:
“Nessie account balance + Nessie-reported posted deposits”. It returns `accountBalance`,
`postedDepositsTotal`, `displayTotal`, and `postedDepositIds`, all from API reads.
Only `completed` deposits with medium `balance` count; duplicate IDs/invalid amounts
raise an exception. This is not available funds or settlement; it excludes withdrawals
and would double-count if the sandbox begins updating its balance. `readBalance`
continues to return the provider field verbatim.

`listTransactions` combines tagged deposits and withdrawals, the supported feed
routes. It intentionally excludes transfers: GET /accounts/<id>/transfers returned
404 on the current host despite older SDK documentation. Provider IDs are UUIDs
on this host, despite the OpenAPI's 24-character examples.

## Verification

```sh
pnpm --filter @backroom/nessie test
pnpm --filter @backroom/nessie typecheck
# Only opt-in live script; loads root .env.local without printing it.
# Seeds Northfield, reuses a fixed invoice/installment reference, writes redacted evidence under ignored .nessie-state/.
pnpm --filter @backroom/nessie live -- --confirm-sandbox
# One fixed, idempotent $1 AP debit; prints only redacted IDs.
pnpm --filter @backroom/nessie debit:live -- --confirm-sandbox-debit
# Optional diagnostic variants: one-time mutation claims; reads on replay.
pnpm --filter @backroom/nessie live -- --confirm-sandbox --probe-variants
```

The live command returns nonzero when T4 fails. Repeated runs reuse the same
resources and deposit. `.nessie-state/` is ignored, but must be preserved across
restarts. API host and contract: [official docs](https://prod.nessieisreal.com/docs)
and [published OpenAPI](https://prod.nessieisreal.com/nessie-openapi-spec.yaml).

## Outage fallback for the balance display (spec 6.3, #184)

`readBalanceDisplay(accountId)` is `readBalanceWithPostedDeposits` plus freshness: live first, and with a
`displayCache` option it returns the last good figures with `cached: true` and
`freshness: 'cached at HH:MM UTC'` during a Nessie outage (network, timeout, 429 or 5xx; at most 24 h old).
Invalid data and refusals still throw. `NessieError.outage` marks outage failures. Never use the cached
display for deposits, reconciliation or health probes; those keep the live methods.

