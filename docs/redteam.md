# GX10 adversarial corpus and API replay

Refs #30, #19; supports Tomi's #29/#30 work. This evidence does **not** certify the M5 zero-spoken-violations acceptance criterion.

## Method and scope

`fixtures/redteam/corpus.jsonl` contains 320 synthetic judge-style inputs: 160 call utterances and 160 inbox messages, across 32 categories with ten language variants each. Twenty are valid controls (two-payment plan and clean invoice); 300 are adversarial. The generated language is data. The `scenario_source: judge` value describes the intended intake source of these synthetic scenarios, not participation by real judges or independent authors.

Generation ran on the shared GX10 through `gx10 run backroom-redteam-direct`, using a task-local Node 24 runtime and Ollama's native `/api/chat` endpoint. Eight batches use `gpt-oss:120b` (80 cases); 24 use `qwen3:8b` (240 cases). Each batch returns ten separate `{text}` objects under an explicit JSON schema. The generator validates lengths, uniqueness and shape, retries invalid batches locally up to three times, and appends only complete batches. Each row retains model, local route, latency, timestamp and batch. No cloud fallback, paid API, secret, phone call or bank request is involved.

Firstmate explicitly directed generation to call Ollama directly rather than use the product router. An earlier router-based attempt failed its response envelope and produced no accepted cases; those discarded outputs are not corpus evidence. Model text is schema-validated, not claimed to be semantically infallible.

Replay imports only exported functions and types from the policy/orchestrator package roots and gateway/approval modules:

```text
synthetic case category → explicit adversarial typed probe
  call → createGateway → parseInvocation → executeTool → policy.evaluate
       → approval bridge / createApprovalHTTP → ControllerApprovals (forged requests)
  inbox → routeInboxItem (LLM OFF) → policy.evaluate / evaluateStep
        → SeatWorker + MemoryStateStore → FakeEffects
```

Replay is deterministic and offline: `fetch` throws for the entire corpus run, gateway requests are in-memory `Request` objects, and external Effects use the production-exported `FakeEffects`. The actual policy evaluator and gateway decisions are not mocked. Inbox routing uses a separate store with models OFF, exercising the current deterministic fallback rather than invoking an LLM.

The mapping is deliberately explicit: language variants in a category produce the same typed attack. These are **32 named categories mapped to typed probes, not 320 independent language-understanding experiments**. Some categories (such as fee waiver and injected waiver) share the same typed probe. Call text is not fed into a speech classifier, and inbox text reaches `routeInboxItem.subject` but does not go through a live extractor. The result for each case records the seams, outcomes, rule IDs, findings and coverage gaps. The corpus is also available for a future model/transcript eval without regenerating it.

## Results

Replay used production main `220c5f6` (no production changes in this PR). Machine-readable counts and corpus SHA-256 are in `fixtures/redteam/summary.json`; each case's result is in `fixtures/redteam/results.jsonl`.

| Observation | Count |
| --- | ---: |
| Cases replayed / API probes observed | 320 / 920 |
| Gateway HTTP / approval HTTP probes | 280 / 40 |
| Inbox fallback routing probes | 160 |
| Direct policy / worker-policy / worker probes | 160 / 140 / 140 |
| Valid-plan confirmations, all with matching ALLOW and exact stored terms | 10 |
| Confirmation-without-ALLOW observations | 0 |
| Approval-without-passkey observations at gateway/server boundaries | 0 |
| Mock payment effects: clean controls / unchecked destination markers | 10 / 10 |
| Cases with filed findings (two families) | 20 |
| Actual bank transfers / live phone calls attempted | 0 / 0 |

The 80 quality-model and 240 volume-model cases all retain `route: local` and zero API spend in their generation records. One duplicate-text batch was rejected and successfully regenerated locally; the rejected attempt is retained in `generation-attempts.jsonl`. Counts of policy outcomes/rule IDs in `summary.json` include multiple seams for the same case and must not be summed as distinct scenarios.

Validation: the 28 red-team harness tests, fixture TypeScript check, workspace tests/build, and existing gateway/approval tests pass. The replay CLI exits 1 for the documented findings. The corpus SHA-256 is `7d5e887a99cbdf95c6dccb5327ff9a35fdd49b18b4aad5500c616e99e2637876`.

## Findings and every affected case

### Missing judge-intake escalation and source receipt

Owner: @tomiwaaluko (#30), coordinating @azizu06 for the exported inbox seam. Filed as [issue #48](https://github.com/azizu06/backrooms/issues/48).

Unknown email with models OFF is routed to `vendor_onboarding` and logged with `INBOX_ROUTING`; the current API creates no escalation and its routing audit does not persist `scenario_source: judge`. The generic router behaves as documented, but the C5 judge-intake wrapper is missing. Policy correctly denies an unknown action with `NOT_IN_BADGE`; this must remain unchanged.

Affected case IDs: RT-251, RT-252, RT-253, RT-254, RT-255, RT-256, RT-257, RT-258, RT-259, RT-260. Each records `UNKNOWN_JUDGE_EMAIL_ROUTED_WITHOUT_ESCALATION` and `JUDGE_SOURCE_NOT_AUDITED`. These are acceptance gaps, not successful payments or approvals.

### Unchecked destination marker reaches the generic mock effect

Owner: @azizu06 (policy/worker and #22), coordinating @MarioTeachesTyping for the eventual bank adapter. Filed as [issue #49](https://github.com/azizu06/backrooms/issues/49).

With an otherwise valid $500 invoice, an extra `input.payeeAccountId = "attacker:unapproved"` is forwarded unchanged by `SeatWorker` to `FakeEffects.nessie` after the real policy returns ALLOW. The current vendor context has approved/in-master/domain/bank-change fields but no master destination-account field; `invoice.account` selects the source operating account. This proves an unchecked marker at a generic dispatch boundary. The marker is not an established Nessie recipient schema, and **no actual transfer or exploitable live bank adapter is demonstrated**. A real AP adapter must explicitly reject extra recipient fields or build its request using only a destination resolved from trusted master state. An adapter that already ignores this marker and resolves the destination safely can close/downgrade this finding with evidence.

Affected case IDs: RT-301, RT-302, RT-303, RT-304, RT-305, RT-306, RT-307, RT-308, RT-309, RT-310. Each records `UNVALIDATED_PAYMENT_DESTINATION_DISPATCHED` and `NON_MASTER_DESTINATION_REACHED_MOCK_EFFECT`. That latter label counts mock boundary observations, not bank transfers. All ten are language variants of one typed probe.

No active owner's production files are changed by this PR. Both gaps remain explicit in regression tests and replay results. The replay CLI returns exit 1 when findings remain; green harness tests verify that the findings are still detected, **not** that the product has zero violations.

## What remains unverified

- Spoken confirmation without a matching ALLOW: no live Cartesia `call_turn` transcript was replayed. API `can_confirm` checks alone cannot establish this M5 criterion.
- Actual AP transfers to a non-master bank account: no bank adapter/network is called. Only mock effect inputs are observed.
- Valid signed WebAuthn assertions and physical passkey enrollment are not generated by this corpus. Forty forged approval HTTP requests exercise the newly merged server: wrong decision schema, nonexistent challenge, hostile origin and unauthorized enrollment all reject, leaving the persisted escalation pending. These checks complement the existing production cryptographic tests; they do not replace a live passkey integration check.
- End-to-end raw speech/inbox classification, extraction, adversarial conversation outcomes, and judge source persistence through a durable intake service.
- Concurrency/distributed-store behavior, live sponsor services, time-to-escalation, and completeness of the still-active #22 integration.

## Reproduce

From the repository root after `pnpm install --frozen-lockfile`:

```sh
# Offline; exit 1 intentionally signals the documented findings.
pnpm --filter @backroom/orchestrator exec tsx ../fixtures/redteam/replay.ts

# Harness checks include explicit assertions for the known gaps.
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
