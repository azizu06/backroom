# Payables + Vendor onboarding (#22, stream A)

Server-only seat logic. Diego owns the tray form and its server adapter; this
change does not add an HTTP route or edit `web/`. Import public exports from
`@backroom/orchestrator` (or `src/payables/index.ts`, `src/vendor/index.ts`).

```text
processInbox(email/invoice)
  route(inbox_classification) → route(field_extraction, strict schema)
  PayablesSeat.process → master + exact PO + policy → bank receipt OR escalation
  VendorSeat.propose → CRS business + OFAC + Apify + domain → awaiting_controller
  VendorSeat.apply → recorded passkey decision → atomic approved master change
```

## Server adapter contract

- `processInbox(item: FinanceInboxItem, { state, controller, payables, vendor })` returns `SeatResult`.
  Set `source: 'judge'` on the server for tray submissions. `senderDomain` is
  envelope metadata, never an extracted authority field. Unsupported/invalid
  documents, missing sender domains, router failures, and unknown classifications
  produce `ESCALATE`; audit inputs include `scenario_source: judge`. A paused
  router (`LLM_OFF`) also escalates without making network calls; typed seat
  policy checks continue to work. Preserve the existing `routeInboxItem` API for
  queue selection; `processInbox` handles full AP/vendor extraction and execution.
- `PayablesSeat({ repository, state, controller, nessie? }).process(fields, source)`
  validates again, checks PO vendor/amount/line items, and invokes policy with
  trusted master/history. Payment destination always comes from the approved
  master. Pending bank-change proposals also hold payments to the old account. `bankAccountId` is an opaque ID for the complete bank details in that
  master; any differing ID holds payment. Money is integer USD cents.
- `VendorSeat({ repository, state, controller, checks }).propose(fields, source)`
  runs fixed CRS business/OFAC and Apify footprint checks using a trusted
  vendor-ID-to-sandbox-identity mapping. Unknown OFAC, errors, missing footprint,
  or domain mismatch never verify. Its proposal is immutable and persisted
  **before** requesting a controller decision. Verification cannot pay or write
  master bank details.
- `VendorSeat.apply(inboxId)` reads its exact escalation from authoritative state.
  It uses #51's `StateStore.expireEscalations/getEscalation` APIs and requires a
  recorded `{ kind: 'Approve' }` decision, `method: passkey`, credential ID,
  timestamp within the approval window, matching policy version/controller/
  evidence/rule, and the original master revision. A valid approval lets
  `commitApprovedChange` atomically update the master and proposal to `approved`.
  Counter and pending_owner outcomes remain held; denial rejects; a stale
  revision holds for a fresh proposal.
- `controllerForLease(state, lease)` bridges the exported StateStore APIs.
  Enqueue/claim a task for the correct seat before binding it. Task refs must
  include the inbox ID and invoice ID for AP tasks, or the inbox ID for vendor
  tasks. Shared `createEscalation` atomically sets the controller desk target.
  `ControllerApprovals` owns decision writes through the shared
  `StateStore.decideEscalation(VerifiedApproval, now)` reducer; this binding only
  requests review and never mints approval capabilities. Never deserialize
  `ControllerPort`, a policy context, or a verification callback from a request.
- All model calls use exported `route()` and strict schemas. Router owns two
  local schema attempts, cloud fallback, and route/model/latency/cost metadata.
  These models have no tools. Only validated typed fields reach the fixed seat
  actions; raw documents, scraped text, and privilege fields never reach effects.

## Integration status and persistence

`FinanceRepository` is the durable reducer adapter boundary. Implement its
namespaced locks (`vendor:<id>` and `proposal:<id>`) across **all** payment/master
writers, with server fencing, and implement `commitApprovedChange` atomically
with a compare on `baselineRevision`. `MemoryFinanceRepository` is explicitly
single-process demo/test storage, not durable SpacetimeDB integration.

A payment reservation is persisted before network I/O. Replays reuse a confirmed
receipt; an uncertain attempt stays held and is never automatically retried.
Held invoices with no payment attempt may be reevaluated against fresh state,
including after a controller-approved master update. Bank adapters must also
provide durable idempotency for the supplied key and reject changed payloads.

`nessiePayables(effects, repository)` bridges exported `Effects.nessie`. Pass the
same server-owned repository used by `PayablesSeat`; the bridge runs under that
seat's vendor lock and freshly validates the explicit destination against the
approved master before dispatch. Recipient aliases and extra fields reject. It requires an
explicit completed/pending external receipt and refuses generic simulated
success. `FakeEffects(repository)` also validates inside its own boundary under
the vendor lock, derives clean generic-worker destinations from the master, and
strips raw source documents. Without a repository it uses an empty master and
rejects payments. Effect-boundary rejections are audited by `SeatWorker` as
`payment_boundary_rejected`, `DENY`, `PAYEE_NOT_IN_MASTER`. The current Nessie client provides deposits, not an AP debit method.
**Leave `nessie` unset until the integration owner supplies a debit-capable
adapter**; this path escalates and never claims payment. CRS sponsor product
configuration and the Apify adapter are also injected capabilities: missing or
unknown evidence holds. No guessed provider endpoints or fabricated clearances.

## Validation

`pnpm --filter @backroom/orchestrator exec vitest run src/payables src/vendor`
uses network-free public-seam tests, including real P-256 signed approvals
through the shared ControllerApprovals verifier and StateStore reducer. The
`northfield.ts` adapter imports the frozen `fixtures/company/northfield.json`:
master bank references, pending holds, OFAC fixture signals, POs, and historical
paid invoices. References are synthetic local IDs, not provisioned Nessie IDs.
`InvoiceFields.adjustmentCents` is optional, nonnegative integer cents; totals
must equal items plus adjustment. This preserves #4419's $37 adjustment without
rewriting the duplicate line items. Candidate vendors retain `inMaster:false`;
only verified controller approval makes them approved master entries.

`pnpm demo:core` checks P01–P09 against the frozen answer key (P02 uses its
specified isolated bank-change precondition), the Cedar passkey gate and next
payment from the updated master, and the unmatched already-paid deposit.
CRS/Apify/debits are mocked and the authenticator is software. This is local
integration proof, not live sponsor evidence or an approved eval run. Real
debit/reconciliation, provider identity mapping, physical passkey and tray UI
remain separate integration gates. The red-team replay uses the same seed adapter;
see `docs/redteam.md` for exact scope and limitations.

Opt-in extraction-only check (no payments or master writes):
`PAYABLES_LIVE=1 pnpm --filter @backroom/orchestrator exec tsx src/payables/live.ts`.
It uses the router's real GX10 configuration and prints only routing metrics and
an exact-answer check. The implementation run did not complete this live check;
no successful live extraction or cloud fallback is claimed. Provider-specific
live scripts remain owned by their existing integration modules.
