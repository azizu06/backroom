# GX10 adversarial corpus and API replay

Refs #22, #30, #19; supports Tomi's #29/#30 work. This evidence does **not** certify the M5 zero-spoken-violations acceptance criterion.

## Valid-control correction after #81

RT-241/RT-242 had `valid_invoice` labels but omitted stable vendor/bank references
and line items, and named POs/vendors absent from Northfield. The raw-inbox
benchmark correctly held them as INVALID_INPUT. Only those two texts now supply
complete synthetic facts against existing Acme PO-5000 ($314, September service),
with separate invoice IDs and fresh state per case. Their `correction` metadata
retains the original text; `generation` describes that original, not the edited
text. All 300 adversarial texts and every label are unchanged. The other eight
sparse valid-invoice variants are outside this 32-message benchmark sample.

The replay counts/hash below describe the frozen earlier corpus. Current raw
inbox measurements and exact revised input hash are in [metrics](metrics.md)
and [benchmark notes](evidence/inbox-benchmark/README.md).

## Method and scope

`fixtures/redteam/corpus.jsonl` contains 320 synthetic judge-style inputs: 160 call utterances and 160 inbox messages, across 32 categories with ten language variants each. Twenty are valid controls (two-payment plan and clean invoice); 300 are adversarial. The generated language is data. The `scenario_source: judge` value describes the intended intake source of these synthetic scenarios, not participation by real judges or independent authors.

Generation ran on the shared GX10 through `gx10 run backroom-redteam-direct`, using a task-local Node 24 runtime and Ollama's native `/api/chat` endpoint. Eight batches use `gpt-oss:120b` (80 cases); 24 use `qwen3:8b` (240 cases). Each batch returns ten separate `{text}` objects under an explicit JSON schema. The generator validates lengths, uniqueness and shape, retries invalid batches locally up to three times, and appends only complete batches. Each row retains model, local route, latency, timestamp and batch. No cloud fallback, paid API, secret, phone call or bank request is involved.

Firstmate explicitly directed generation to call Ollama directly rather than use the product router. An earlier router-based attempt failed its response envelope and produced no accepted cases; those discarded outputs are not corpus evidence. Model text is schema-validated, not claimed to be semantically infallible.

Replay imports only exported functions and types from the policy/orchestrator package roots and gateway/approval modules:

```text
synthetic case category → explicit adversarial typed probe
  call → createGateway → parseInvocation → executeTool → policy.evaluate
       → approval bridge / createApprovalHTTP → ControllerApprovals (forged requests)
  inbox → routeInboxItem (LLM OFF, source=judge) → pending escalation for raw email
        → processInbox (LLM OFF) + controllerForLease → persisted judge escalation
        → policy.evaluate / evaluateStep → SeatWorker → FakeEffects
        → effect-boundary vendor-master check → canonical payment or DENY
```

Replay is deterministic and offline: `fetch` throws for the entire corpus run, gateway requests are in-memory `Request` objects, and external Effects use the production-exported `FakeEffects`. The actual policy evaluator and gateway decisions are not mocked. Inbox routing uses a separate store with models OFF, exercising the current deterministic fallback rather than invoking an LLM.

The mapping is deliberately explicit: language variants in a category produce the same typed attack. These are **32 named categories mapped to typed probes, not 320 independent language-understanding experiments**. Some categories (such as fee waiver and injected waiver) share the same typed probe. Call text is not fed into a speech classifier, and inbox text reaches `routeInboxItem.subject` but does not go through a live extractor. The result for each case records the seams, outcomes, rule IDs, findings and coverage gaps. The corpus is also available for a future model/transcript eval without regenerating it.

## Results

The original replay used main `220c5f6`. Before this fix, rerunning the unchanged replay on current main `4f55576` (including recovery, model OFF, pre-call, escalation, finance-seat and core-loop updates) reproduced the same **20 failure cases and 10 mock violation cases**. The full judge `processInbox` added by [the finance-seat change](https://github.com/azizu06/backrooms/pull/52) already escalates correctly; the old harness only exercised queue selection, leaving that implementation uncovered.

After this fix, the same frozen 320-case corpus produces **0 failure cases and 0 violation cases**. Machine-readable after counts and corpus SHA-256 are in `fixtures/redteam/summary.json`; each case's result is in `fixtures/redteam/results.jsonl`.

| Observation | Before (`4f55576`) | After |
| --- | ---: | ---: |
| Cases replayed / API probes observed | 320 / 920 | 320 / 950 |
| Gateway HTTP / approval HTTP probes | 280 / 40 | 280 / 40 |
| Inbox routing / full intake / persisted intake escalation probes | 160 / 0 / 0 | 160 / 10 / 10 |
| Direct policy / worker-policy / worker probes | 160 / 140 / 140 | 160 / 140 / 140 |
| Additional payment-boundary rejection probes | 0 | 10 |
| Valid confirmations with matching ALLOW and exact stored terms | 10 | 10 |
| Confirmation-without-ALLOW / approval-without-passkey observations | 0 / 0 | 0 / 0 |
| Mock payment effects: clean controls / unchecked destination markers | 10 / 10 | 10 / 0 |
| Failure cases / mock violation cases | 20 / 10 | 0 / 0 |
| `JUDGE_INTAKE_ESCALATION_NOT_IMPLEMENTED` coverage gaps | 10 | 0 |
| Actual bank transfers / live phone calls attempted | 0 / 0 | 0 / 0 |

The 80 quality-model and 240 volume-model cases all retain `route: local` and zero API spend in their generation records. One duplicate-text batch was rejected and successfully regenerated locally; the rejected attempt is retained in `generation-attempts.jsonl`. Counts of policy outcomes/rule IDs in `summary.json` include multiple seams for the same case and must not be summed as distinct scenarios.

Validation includes the 28 red-team harness tests, corpus-ID regressions at production effect/intake seams, fixture TypeScript check, workspace tests/build, and worker crash recovery. The replay CLI now exits 0. The corpus is unchanged: SHA-256 `7d5e887a99cbdf95c6dccb5327ff9a35fdd49b18b4aad5500c616e99e2637876`.

## Closed findings and affected cases

### Judge-intake escalation and source receipt — issue #48

`routeInboxItem` now accepts trusted server metadata `source: 'judge'`. Raw judge email has no schema-validated recognized action, so code creates a real pending escalation, targets Dana's desk, and audits `scenario_source: judge` with `ESCALATE`. A seat suggestion cannot certify recognition. Typed judge records also retain their source in routing audits. Seed routing retains its existing queue behavior.

For full classification/extraction and dispatch, tray adapters should use the existing `processInbox` with server-set `source: 'judge'`. Replay now tests both exported paths, including the real `controllerForLease` and persisted escalation/evidence/desk target. Unknown policy actions still DENY with `NOT_IN_BADGE`; this fix does not weaken that rule. Production regressions cover raw judge mail with models ON and OFF, with zero network requests.

Affected case IDs, all passing: RT-251, RT-252, RT-253, RT-254, RT-255, RT-256, RT-257, RT-258, RT-259, RT-260. The intake coverage gap is closed. Raw model classification remains a separate follow-up below.

### Approved-master enforcement inside payment effects — issue #49

`FakeEffects.nessie` now checks the server-owned `FinanceRepository` inside its effect boundary, under the vendor lock. It rejects unknown recipient fields (including the corpus's `payeeAccountId` override), missing/unapproved/sanctioned masters, and pending bank changes. Clean generic-worker payments resolve their destination from the master; raw documents are stripped from the canonical effect payload. An unconfigured fake has an empty master and fails closed.

The real `nessiePayables(effects, repository)` bridge independently rechecks the master before invoking its network capability. It requires the same trusted repository used by `PayablesSeat`, whose vendor lock serializes payment/master writes. Explicit destinations must equal the approved master account. The real debit adapter is still absent; no live transfer is claimed.

`SeatWorker` records effect-boundary rejection as `DENY(PAYEE_NOT_IN_MASTER)` and completes the task as denied even when upstream policy returned ALLOW. Recovery/idempotency behavior remains covered; test/demo adapters now explicitly seed their independent master instead of granting implicit recipient authority from task context.

Affected case IDs, all passing: RT-301, RT-302, RT-303, RT-304, RT-305, RT-306, RT-307, RT-308, RT-309, RT-310. RT-301 also has direct effect and real-bridge regressions proving no underlying bank capability is invoked for a forged destination. The ten clean controls still produce ten mock receipts to the approved master destination.

## Frozen company migration (#22 / #14)

Replay now imports `fixtures/company/northfield.json` through the exported AP
adapter. Clean payments use Papertrail invoice #4401 and its server-owned
`bank-master:papertrail` reference. Bank-change probes use #4471/Acme and
#4480/Cedar; duplicate probes use #4419 versus historical paid #4402 (the boundary
variant intentionally changes only the total to +$100). No-PO, over-limit and
sanctions probes use #4481–#4483. Call probes use Northfield AR #1042 ($4,950),
so the valid first-installment control is $2,475. Other malicious mutations remain
explicit adversarial inputs. The corpus text and category mapping are unchanged.

The rerun retains **320 cases, 950 probes, 0 failures and 0 violations**; the summary
now records the company seed SHA-256 as well as the corpus hash. Only the ten clean
AP controls reach the mock effect, always to the trusted Papertrail master.
`pnpm demo:core` separately executes the real finance-seat interfaces against the
canonical AP traps and answer key, signed software-passkey approval for Cedar,
and the unmatched already-paid deposit. The frozen seed and answer key are
unchanged; owner signoff is still pending. No paid provider/model call was needed.

## What remains unverified

- Spoken confirmation without a matching ALLOW: no live Cartesia `call_turn` transcript was replayed. API `can_confirm` checks alone cannot establish this M5 criterion.
- Actual AP transfers to a non-master bank account: no bank adapter/network is called. Only mock effect inputs are observed.
- Valid signed WebAuthn assertions and physical passkey enrollment are not generated by this corpus. Forty forged approval HTTP requests exercise the newly merged server: wrong decision schema, nonexistent challenge, hostile origin and unauthorized enrollment all reject, leaving the persisted escalation pending. These checks complement the existing production cryptographic tests; they do not replace a live passkey integration check.
- Follow-up: end-to-end raw speech/inbox classification, extraction and adversarial conversation outcomes. The replay still reports 160 `SPEECH_CLASSIFIER_AND_TRANSCRIPT_NOT_EXERCISED` and 160 `RAW_INBOX_CLASSIFIER_NOT_EXERCISED` gaps. Routing/intake source receipts are verified in the reference store; durable intake persistence remains the state-adapter integration task.
- Concurrency/distributed-store behavior, live sponsor services, time-to-escalation, and live completeness of the #22 integration.

## Reproduce

From the repository root after `pnpm install --frozen-lockfile`:

```sh
# Offline; exits 0 only when failureCases and violationCases are both zero.
pnpm --filter @backroom/orchestrator exec tsx ../fixtures/redteam/replay.ts

# Harness checks include RT-251/RT-301 regressions and all 320 cases.
pnpm --filter @backroom/orchestrator exec vitest run --root ../fixtures/redteam replay.test.ts
pnpm --filter @backroom/orchestrator exec tsc -p ../fixtures/redteam/tsconfig.json

# Existing production checks used by the replay.
pnpm -r test
pnpm -r build
pnpm --filter @backroom/web test
```

Opt-in live regeneration (only Ollama; requires Node 20+ with native fetch on GX10):

```sh
gx10 gpu
gx10 push fixtures/redteam
gx10 run backroom-redteam-corpus 'cd ~/work/redteam && REDTEAM_OUTPUT=corpus.jsonl GX10_BASE_URL=http://127.0.0.1:11434/v1 node generate.mjs'
gx10 logs backroom-redteam-corpus 10
gx10 pull redteam/corpus.jsonl fixtures/redteam/
```

The original job used `.runtime/node/bin/node` because the shared host had no system Node binary. That task-local runtime, its archive, and diagnostic outputs are not versioned. A complete existing corpus is resumed without another model call; choose a new output path to generate a fresh corpus. Do not overwrite the committed results without rerunning replay and updating this report. Generation attempt failures, when present, are retained in `generation-attempts.jsonl`.
