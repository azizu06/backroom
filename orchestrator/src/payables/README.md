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
  It requires approval, `method: passkey`, decision timestamp, controller identity,
  matching evidence reference/rule, and the original master revision. Only then
  does `commitApprovedChange` atomically update the master and proposal to
  `approved`. Denial rejects; a stale revision holds for a fresh proposal.
- `controllerForLease(state, lease)` bridges the exported StateStore APIs.
  Enqueue/claim a task for the correct seat before binding it. Task refs must
  include the inbox ID and invoice ID for AP tasks, or the inbox ID for vendor
  tasks. An escalation sets the agent target to the controller's desk. The controller/passkey service owns decision writes. Never deserialize
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

`nessiePayables(effects)` bridges exported `Effects.nessie`; it requires an
explicit completed/pending external receipt and refuses generic simulated
success. The current Nessie client provides deposits, not an AP debit method.
**Leave `nessie` unset until the integration owner supplies a debit-capable
adapter**; this path escalates and never claims payment. CRS sponsor product
configuration and the Apify adapter are also injected capabilities: missing or
unknown evidence holds. No guessed provider endpoints or fabricated clearances.

## Validation

`pnpm --filter @backroom/orchestrator exec vitest run src/payables src/vendor`
uses network-free public-seam tests. AP/vendor cases are clearly marked
**temporary synthetic fixtures**; canonical #14 fixtures were absent from main
when this implementation began. Existing policy/worker tests also cover
cross-seat denial and lease recovery. Canonical fixture replay, live CRS/Apify,
real debit/reconciliation, and the tray UI remain integration evidence.

Opt-in extraction-only check (no payments or master writes):
`PAYABLES_LIVE=1 pnpm --filter @backroom/orchestrator exec tsx src/payables/live.ts`.
It uses the router's real GX10 configuration and prints only routing metrics and
an exact-answer check. The implementation run did not complete this live check;
no successful live extraction or cloud fallback is claimed. Provider-specific
live scripts remain owned by their existing integration modules.
