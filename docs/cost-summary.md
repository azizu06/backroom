# Cost-per-invoice API

Server adapter exported from `@backroom/orchestrator`:

```ts
import { createCostSummaryHandler, createRecordedCostReader } from '@backroom/orchestrator';
const GET = createCostSummaryHandler({
  recorded: createRecordedCostReader({
    store: () => sharedStateStore,
    // Persist server-owned CaseResult snapshots from Dispatcher.onEvent(case_finished).
    cases: async () => savedCases.map(({ result, invoiceId }) => ({ result, invoiceId })),
    // Optional: map legacy audit ids/refs using your authoritative invoice/task index.
    linkAudit: entry => authoritativeLink(entry), // {runId, invoiceId: string | null}
  }),
});
```

Diego owns the web mount/proxy: intended route `GET /api/costs`. This change supplies
its Request/Response handler; it does not mount a Next route or change the office.
Call it from a server-side proxy with `Authorization: Bearer TOOL_GATEWAY_SECRET`.
Never put the secret in client props or `NEXT_PUBLIC_*`. All responses are no-store.
Only GET is allowed (405); missing config is 503, bad credentials 401, bad queries
400, and unavailable/inconsistent records 503. There is no model/tool invocation,
state mutation, automatic demo fallback, or payment authority.

Query fields (each at most once):

- `source=recorded` (default): reads the shared `StateStore.listAudit()` and supplied runtime snapshots.
- `source=demo`: deterministic illustrative AP 4401 and AR 1042 role-chain receipts, no network or key.
- `invoiceId` and `runId`: optional exact filters, intersect when both supplied.

`recorded` describes the storage source, not proof of live inference: a host can
contain mock audits. Only `source=demo` is automatically labeled simulated; the
host remains responsible for labeling rehearsal/live provenance.

Response shape (`schemaVersion: 1`):

```text
{ source, simulated, accounting,
  totals: Aggregate,
  runs: [{ runId, invoiceIds, ...Aggregate }],
  invoices: [{ invoiceId, ...Aggregate }],
  unassignedCalls,
  records: [{ id, runId, invoiceId, origin, execution, models,
              costUsd, costBasis?, inputTokens, outputTokens,
              cacheReadTokens, cacheWriteTokens, latencyMs }] }
Aggregate = { calls, costUsd, reservationCostUsd, models,
              inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
              tokenCompleteCalls, latencyMs,
              localCalls, cloudCalls, localShare, cloudShare,
              localCostUsd, cloudCostUsd }
```

`origin` is sdk/router/local_tool; `execution` is local/cloud. Shares are fractions
of accounted operations, null for empty groups. An SDK session is one operation,
a standalone router/local-tool receipt another. This is not HTTP attempt coverage.
Per-run identifiers from the dispatcher are activation IDs (one specialist turn).
`invoiceIds` allows a legacy run to involve multiple explicitly linked invoices.
Unassigned rows stay in totals/runs, outside invoice totals.

## Accounting boundaries

- `readCaseUsage(result, invoiceId)` reads the real `CaseResult` and returns normalized
  records, `caseChargedUsd`, and the latest `ownerBudget` snapshot. Its conservative
  unknown-settlement cost matches the dispatcher. `costBasis: reservation` and
  `reservationCostUsd` distinguish that charge from a provider estimate. Owner
  totals/reservations are credential-wide and are never allocated to an invoice.
- `readActivationUsage` accepts raw `UsageReceipt` snapshots plus trusted
  `runId`/`invoiceId` metadata. Latest cumulative session snapshot wins in input
  order; do not sum retransmissions. A session reused across invoice/run boundaries
  is rejected. Code-only receipts are excluded. Choose either case snapshots or
  raw activation snapshots for a given session, so its linkage stays consistent.
- SDK model token usage includes cache counts separately. Missing counts are null
  per record; aggregate tokens are **known subtotals**, with `tokenCompleteCalls`
  reporting input/output coverage. Never display an unknown count as measured zero.
- SDK USD is list-price estimation; the provider Console remains billing authority.
  Router USD is its recorded estimate. GX10 $0 means API spend only, excluding
  hardware, electricity, telephony and other services. No invented avoided-cloud savings.
- `latencyMs` is the sum of operation durations, not elapsed run time. SDK turn time
  may include a nested local tool, so adding their latencies overlaps wall time.
- Existing router telemetry has only process-wide aggregates and cannot be allocated
  to invoices. Existing audit receipts often omit token counts/run or invoice IDs;
  the default reader only trusts explicit `inputs.invoiceId`/runId/activationId/taskId.
  It does not guess invoice identity from a document/client ref. Supply `linkAudit`
  using the host's authoritative index; otherwise these records remain unassigned.
- The current runtime ledger stores owner totals, not per-invoice receipts, and
  `UsageLedger.usage()` can write its file. This reader never calls it. Supply
  retained dispatcher results to expose actual per-run SDK costs; the default
  audit-only reader cannot recover SDK receipts that were not persisted.
- SDK audit mirrors (`route=claude-agent-sdk`), code/policy events and the OFF switch
  are excluded. Local extraction is counted only when a real model receipt exists;
  the current extractor does not persist one, so absent GX10 observations stay absent.

Demo numbers are illustrative, not live measurements or actual mock spend. They
follow the AP intake→extractor→vendor→payables→auditor and AR
collections→reconciler→auditor chains in `agents/demo-team.ts`. Demo totals:
$0.021 illustrative cloud cost, 8 cloud operations, 2 $0 GX10 operations,
10,700 input and 1,090 output tokens; token cache reads are separate.

Validation: `pnpm --filter @backroom/orchestrator exec vitest run
src/agents/usage-reader.test.ts src/agents/cost-api.test.ts` and
`pnpm --filter @backroom/orchestrator build`. Tests include both real dispatcher
mocked chains, aggregation, cumulative sessions/cache tokens, reservation fallback,
authentication, read-only behavior, query filters and offline repeatability.
