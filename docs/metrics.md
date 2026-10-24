# Proof-it-works metrics

Generated: 2026-10-24T09:23:36.279Z
Source git SHA: `295328b63b85c03a06591d593b99b6ecde4d64c9` (report/tool changes may be uncommitted at generation time).
Exact command (repository root): `pnpm metrics --audit docs/evidence/live-run/2026-10-24T09-20-39.386Z/collections.audit.json --audit docs/evidence/live-run/2026-10-24T09-20-39.386Z/inbox.audit.json --audit docs/evidence/live-run/2026-10-24T09-20-39.386Z/off.audit.json`

Refs #29 #32; spec §7.2. Saved-run mode verifies retained audit chains without network calls. Live service scope and simulation boundaries are documented in [receipt notes](evidence/live-run/README.md); the live-model sample uses an explicit GX10-only operator override. Historical service receipts are labeled separately.

| Metric | Observed | Evidence / limitation |
| --- | --- | --- |
| Audit chain verification | 3/3 valid; 65 accepted entries | Canonical full chains checked from genesis. Invalid chains excluded from all aggregates. |
| Audit escalations | 14 | Decision records, not deduplicated escalation rows or human approvals. |
| Audit escalations per 100 policy decisions | 53.85 | Explicit denominator: decision-bearing audit entries; not all agent actions. |
| Policy violations (live end-to-end) | not measured — no joined effect/approval receipts or complete speech transcript | DENY/ESCALATE attempts are not violations. A hash-valid audit alone does not prove matching authorization. |
| Human approvals per 100 actions | not measured — audit decision rows are not unique actions or completed human approvals | Do not substitute escalation record counts for actual controller work. |
| Planted traps caught / false holds | not measured — full final-state + integration answer-key checker absent | Policy-step matches alone cannot establish these rates. |
| Live completed model local share (C2) | 100.00% (6/6; operator override; production C2 unverified) | Counts local + gx10_fallback / all completed model decisions in verified live chains; corpus generation excluded. |
| Estimated model cost per completed decision | $0.000000 | Mean recorded costUsd; estimates exclude hardware/electricity, telephony, failed requests and retries. |
| GX10 → cloud fallback events | 0 | route=cloud_fallback; gx10_fallback is the opposite direction (cloud → GX10). |
| Pre-call pipeline p50 (recorded live-model smoke) | 12695.89 ms (n=1) | Historical 2026-10-24T08:02:23.377Z; model=live, CRS=fake, Apify=fake, dial=none. Not a live end-to-end pipeline benchmark. |
| Call ring time | not measured — phone-owner ring confirmation not recorded | docs/t1-cartesia.md reports 8.236 s to connection (upper bound on ring), not exact ring latency. |
| Voice turn latency p50/p90 | not measured — no user-turn-end → audio samples | T1 tool/receiver timing is not voice response latency. |
| Disclosure compliance / wrong-person leakage | not measured — no complete transcript compliance evaluator | T1 welcome was interrupted; configuration does not prove delivery. |
| Prompt-only baseline violations | not measured — baseline on C03/C04/C18/P03/P09 not run | No comparison claim. |
| T10 successful live fallback smoke | incomplete | Recorded 2026-10-24T07:33:53.073264+00:00: Model request failed: HTTP 402. First local request timed out with the 8s production bound; escalation reached OpenRouter but was rejected. No successful live Claude fallback or scenario local share verified. Same-call fallback is covered by network-free tests. |

## Live model route measurements

| Route | Completed decisions | p50 ms | p95 ms | Estimated USD / decision |
| --- | ---: | ---: | ---: | ---: |
| local | 6 | 2110.02 | 5257.09 | $0.000000 |
| cloud | 0 | not measured | not measured | not measured |
| cloud_fallback | 0 | not measured | not measured | not measured |
| gx10_fallback | 0 | not measured | not measured | not measured |

No samples means not measured, not zero latency/cost. Nearest-rank percentiles include all samples and outliers. Route rows count completed audited decisions, not underlying HTTP attempts. Scenario-suite C2 attainment is unverified even when an isolated live smoke succeeds.

## Audit provenance

| Metric | Observed | Evidence / limitation |
| --- | --- | --- |
| docs/evidence/live-run/2026-10-24T09-20-39.386Z/collections.audit.json | 32 entries; live | head=7304eab429d69ea33ae8845da0e4e89d6e096d8f4aaacd058483e75f47d7b5c6 |
| docs/evidence/live-run/2026-10-24T09-20-39.386Z/inbox.audit.json | 18 entries; live | head=bf71e58a0741d8f2e9284dd28ad53029119e6f3fa18b9b3c3f351a286adf0adf |
| docs/evidence/live-run/2026-10-24T09-20-39.386Z/off.audit.json | 15 entries; live | head=51d160f3852725f611ed272dca5c4552c473c762558b411c516f354e19d81a6a |

## Reproduction and interpretation

- Saved runs: `pnpm metrics --audit path.json --audit other.json`. Each file is a full genesis chain array, or `{ "kind": "live" | "simulated", "entries": [...] }`. Bare arrays have unknown provenance and do not establish live model share. Caller-supplied provenance is an assertion, not cryptographic proof. Each file is a separate run; do not supply overlapping snapshots of the same run.
- Every invocation overwrites `docs/metrics.md` and prints this same Markdown. Saved-run mode skips fresh demo/eval/replay; historical receipt rows retain their original dates. Malformed inputs fail; invalid chains remain visible and are excluded.
- The frozen red-team corpus was generated on GX10, but its generation calls are not office decisions and do not contribute to C2. Replay records multiple seams per case, so counts must not be added to eval or demo as unique scenarios.
- Bad historical results remain in [red-team evidence](redteam.md): before the fixes, 20 failure cases and 10 mock violation cases. Current results do not erase those findings.
- Live rehearsal scope, operator routing override, sandbox idempotency and reproduction: [receipt notes](evidence/live-run/README.md). An operator-forced local sample does not establish production C2 attainment.
- Sources: [answer key](../fixtures/answer-key/expected.json), [T1 voice](t1-cartesia.md), [pre-call receipt](../orchestrator/src/collections/live-receipt.json), [T10 router smoke](../fixtures/t10/router-smoke.json).

Answer-key SHA-256: `66e7546da7965c027877b246f4268717dbbbd733a1db5ffc391697dfa4efaabd`
Corpus SHA-256: `7d5e887a99cbdf95c6dccb5327ff9a35fdd49b18b4aad5500c616e99e2637876`

<details><summary>Fresh policy-step eval details (not full final-state grading)</summary>

```text
Not run: --audit selects saved audit evidence only.
```

</details>
