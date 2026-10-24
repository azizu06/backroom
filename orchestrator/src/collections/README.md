# Collections pre-call (M3 / #17)

`runPreCall(input, dependencies)` prepares an internal call plan. It does not dial,
verify identity, approve an exception, or mutate money. Consumers import the public
`collections/index.ts` entry point; `types.ts` defines the integration contracts.

```text
trusted state → policy call permit
               ├─ mapped test identity → CRS credit + OFAC
               └─ real public company  → Apify (40 s deadline)
             → policy stop check → policy envelope → routed call plan
             → code validates every term → ready | blocked
```

Pass a current policy `Context` from trusted server state, including consent,
DNC, business type, client-local weekday/hour, existing stop signals, and the
visible/logged demo override when applicable. The snapshot is copied before
asynchronous work. Re-read state and re-evaluate `call_client` at the actual dial
boundary: `ready` is a prepared plan, not a lasting call permit. Speech must still
use the fixed disclosure and withhold invoice details until identity verification.

## Dependency wiring

- `CreditCheck.check(testIdentityId)` receives only the approved numeric sandbox
  mapping, never the public company. `createCrsCreditCheck(crsClient, scoreSignals)`
  adapts the CRS client's exported `getBusinessCreditReport` and `checkOfac` APIs.
  Both are required; missing/mismatched/unknown data blocks. A sanctions hit
  survives a concurrent credit-product failure. Credit thresholds are an explicit
  owner mapping; this module invents none. The default score mapping changes no
  limits. CRS audit records carry `SANDBOX: test identity #N`, timestamps, numeric
  summaries, and hashes. No raw report, PII, credential, or token is stored.
- `HealthCheck.check(company, abortSignal)` receives the real public company.
  `createApifyHealthCheck(runActor)` accepts the Actor owner's transport and
  projects its `{signals}` output. Typed signals are `maps_status`, `distress_news`,
  `phone_match`, and `website_reachable`; each requires `sourceUrl` and `observedAt`.
  The runner must translate the published Actor output to this small contract.
  No Actor ID or API response is guessed here. Provider failure or a 40 s timeout
  proceeds with the explicit **health check pending** status; abort is requested,
  and late output cannot append audits or change the returned plan.
- `planner: createCallPlanner()` uses the shared router's `call_plan` cloud route.
  Only OpenRouter HTTP 402 permits the authorized `gpt-oss:120b` GX10 fallback,
  recorded as `route=gx10_fallback`, actual model ID, latency, and zero local API
  cost. Other cloud failures block. The fallback sets low reasoning and reinforces the
  shared router JSON wrapper, using its injected HTTP transport. See
  [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility). Unit tests inject the same exported router
  API with mocked HTTP; no network is used by tests.
- The router's `LLM_OFF` result returns `{status:'paused', reason:'LLM_OFF'}`
  with a code audit and no downgrade attempt. Producers should persist this via
  `pauseTask` and rerun the pipeline on resume. Both default routes share the
  process-wide store described in `docs/llm-control.md`; policy stops still run.
- `audit` is the real `StateStore` (only `appendAudit` is required). Every permit,
  check result, envelope, model result/failure, plan validation, and escalation
  appends a record. Returned evidence references include those audit IDs.
- `escalate(decision, evidenceRefs)` is required and awaited. Bind it to
  `store.createEscalation(currentLease, decision, now)` and the existing seat
  worker's human handoff. OFAC and permanent closure return the policy's exact
  `ESCALATE` decision/quote; no model is called. Audit/escalation persistence
  failures reject the operation and cannot return `ready`.

`fakeCreditCheck(result)` and `fakeHealthCheck(result)` are explicit offline
fixtures; fakes never imply live sponsor evidence. Credit calls also have a 40 s
safety deadline and fail closed; unlike health, missing credit is never a pending
clearance. The CRS client owns its own HTTP cancellation/timeout.

## Plan and signal boundary

The model receives only the computed envelope and two booleans: distress-based
plan-order preference and health-pending status. Raw scraped text, company names,
phone numbers, invoice text, and sandbox identity payloads never reach it.

The short plan consists of enum tone/order choices and numeric `Plan` terms.
Extra prose, tool requests, and unexpected fields are rejected. Code validates
all terms through `@backroom/policy.evaluate` using the same signal context and
renders the short summary from validated values. The internal validation's
`identityConfirmed=true` is local to that policy check; it never updates identity
state or grants disclosure permission. Signals are merged with existing stops;
`computeEnvelope` applies only owner-configured narrowing. Distress news provides
an order preference; it never grants additional installments or a fee waiver.

## Verification and live boundaries

```sh
pnpm --filter @backroom/orchestrator exec vitest run src/collections
pnpm --filter @backroom/orchestrator build
pnpm --filter @backroom/orchestrator exec tsx src/collections/live.ts # skips
COLLECTIONS_LIVE=1 pnpm --filter @backroom/orchestrator exec tsx src/collections/live.ts
```

The opt-in model smoke loads repo-root `.env.local`, uses synthetic credit/health,
and never dials. Its JSON receipt distinguishes live models from fakes. It does
not establish CRS/Apify availability or a real pre-call p50. Use the respective
integration owners' opt-in live scripts for those services after sponsor product
configuration and the published Actor transport exist; do not substitute fakes
for their live acceptance gates.

`live-receipt.json` records one successful model-only smoke (12.7 s): OpenRouter
402 → `gpt-oss:120b`, with a code-validated plan. `live-receipt-initial.json` preserves
the initial safe failure before the fallback request was tightened. CRS/Apify in
both receipts are explicitly synthetic. These single samples are not a p50 SLA.
