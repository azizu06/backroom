# Delivery evidence checklist

**Status snapshot: Sat Oct 24, 2026; refreshed for PRs #42/#43.** Sources: spec §§3/5/6/8; merged [policy #38](https://github.com/azizu06/backroom/pull/38), [ask-why #35](https://github.com/azizu06/backroom/pull/35), [gateway #36](https://github.com/azizu06/backroom/pull/36), [workers #37](https://github.com/azizu06/backroom/pull/37); open [router #40](https://github.com/azizu06/backroom/pull/40), [CRS boundary #41](https://github.com/azizu06/backroom/pull/41), [Nessie #42](https://github.com/azizu06/backroom/pull/42), [local SpacetimeDB T8 #43](https://github.com/azizu06/backroom/pull/43). Recheck live state before promoting any claim. Validation below is attributed to those PRs; this docs task did not rerun their tests.

## Acceptance criteria to evidence

| Spec AC | Owner | Evidence needed for final claim | Current evidence / blocker |
| --- | --- | --- | --- |
| M1: saved 2→3 installment limit applies without prompt edit; unauthorized seat denied; audit cites version/rules | A, C/B integration | Before/after saved-policy run; full persisted decisions; same denied action with browser closed | Policy merged; PR #38 reports 94 tests. Save persistence, UI change and runtime parity MISSING. |
| M2: messy company seed; planted traps; frozen answer key | D | Seed revision/hash, freeze signoff, case IDs and expected states; external-author proportion | #14 in progress; full C01–C22 mapping awaits `docs/spec-b.md`. Do not freeze inferred numbering. |
| M3: CRS sandbox label + Apify URL/time; OFAC/closed stop; pipeline timing | C/D/A | Sanitized live request receipts, mapped sandbox ID, source URL, stop decisions, p50 or 40 s pending behavior | Open #41 reports 13 CRS boundary tests; exact product routes/identities await sponsor email/Postman. Live T3 and Apify integration evidence MISSING; Apify T5 tracked #6. |
| M4: phone rings ≤60 s; fixed disclosures every call; identity before amount | A | Consented real call clip + `call_turn` log; dial and ring timestamps; full transcript compliance review | T1 has setup only; no live dial, ring, mid-call tool or turn-stream proof. Merged gateway #36 explicitly placed no call. |
| M5: no confirmed terms without ALLOW; fee denial, 2-payment ALLOW, 4-payment escalation | A/D | Paired audio/tool/audit trace for each case and suite violation denominator | Policy unit behavior exists. #36 reports 23 real-evaluator HTTP tests; integrated spoken commitments MISSING. |
| M6: escalation ≤1 s; decision relayed on same call ≤60 s; passkey-less approval rejected | A/B/C | Correlated decision/row timestamps; real WebAuthn approve/deny receipts and rejected invalid assertion; voice-injection attempt | Gateway reads and fake worker escalation merged in #36/#37. Actual controller/passkey verification and live relay MISSING; local T8 subscriptions do not prove escalation wiring. |
| M7: ALLOW-derived pay amount; Nessie balance read-back; short/duplicate/already-paid outcomes | C/B/D | Sanitized provider IDs, before/deposit/after receipts, exact-match reconciliation and adversarial cases | #42 reports live customer/checking creation, deposits, balance/feed reads. **T4 FAIL:** hosted balance stayed 0 after completed whole-dollar deposit; $1.25 was stored as 1, so fractional-dollar amounts are now rejected by the client. Surface as an exception; deposit/feed success alone is not reconciliation or M7 PASS. Simulated card remains labeled. |
| M8: every AP trap caught; legitimate bank change approved; approved master account only | A/C/D/B | P01–P12 results against frozen key, bank-change approval evidence, account reference audit | Pure policy checks merged. End-to-end vendor verification, bank update and money movement MISSING. |
| M9: 3 correct cited answers; chain tamper detected; voice output | A/B/C/D | Three question results checked against key; state-loader authorization; tamper screen; Cartesia audio | Ask-why merged; synthetic `fixtures/why/` and code fallback exist. Citation IDs do not prove semantic correctness or chain integrity. Live Claude/audio and wall integration MISSING. |
| M10: row→walk ≤1 s; red door matches DENY; browser-closed parity; fallback camera | B/C/D | Subscription timestamps, matching row IDs, parity comparison excluding timestamps, degraded UI recording | Open #43 reports local T8 PASS: shared policy bundles, forbidden reducer write rejected, browser subscription 20/20 DOM updates in 2–5 ms (same host). Maincloud publish failed 401 InvalidSignature; full schema/durable StateStore adapter, avatar walk, red door and parity remain pending. |
| M11: visible real-versus-simulated panel | B/D | Screenshot and video showing current labels; final table checked by owners | Table drafted in this kit; rendered panel MISSING. |
| C1: public Actor + README/input schema + Devpost run ID | D | Public Store URL, source revision, sanitized run/dataset IDs, source URLs, cost/time receipt | MISSING. Local smoke alone does not prove public Actor or Best Actor eligibility. |
| C2: local share ≥60% target; route/latency/cost; live same-call Claude fallback | A/D/B | Full suite request counts; raw timing/cost method; successful local-link-kill trace and displayed route | #40 reports optimized Qwen 8B/20B JSON 5/5; mocked fallback tests. Live OpenRouter returned HTTP 402; successful Claude fallback and suite share MISSING. |
| C3: killed worker recovered; no duplicate payment; no expired task stranded | A/C/D | Real process kill/restart with durable store and provider idempotency/reconciliation receipts | #37 reports fake-effects/lease tests; in-memory state cannot prove full-service restart recovery. |
| C4: 30 conversations ≤10 min, outcome/violations/escalations/key match | D/A | Frozen key, exact run command/commit, complete per-case output and summary denominators | Harness #29 and integrated eval MISSING. T10 extraction benchmark is not this suite. |
| C5: judge cases default unknown→ESCALATE; `scenario_source: judge` | A/B/D | Non-team drill log, unknown intake input trace, source field and escalation | #30 MISSING. Keep policy unknown-action DENY unchanged; intake escalation wraps it. |
| C6: sponsor README kit checked by Sun 7 AM | D + component owners | Final README review and artifact links for every claimed sponsor feature | Drafts here only. README publication and final owner signoff pending. |

## Sponsor proof collection

| Track in spec §5 | Minimum concrete packet to collect | Owner / claim restriction |
| --- | --- | --- |
| Hyphenate | Video opens with actual escalation; seats line; real/sim table; live scenario; frozen-key metrics; 3D-closed proof | D coordinates A/B/C. Full office is an intended demo until the integrated run exists. |
| Cartesia | T1 call receipt, exact catalog model, live webhook/tool round trip and turn stream; setup/features/limitations; demo-first cut near 2 min | A supplies; D edits. Confirm current video-length rules; the overall 2:55 cut may need a separate ~2 min Cartesia cut. |
| CRS | Business-credit + OFAC 200 receipts on approved test identities, sandbox labels, decision effect and data-handling note | C. Do not substitute cached/example responses for meaningful live sandbox use. |
| Nessie | Preserve #42 live customer/checking/deposit/feed receipts and failed balance read-back; require corrected balance gate and transaction/reconciliation trace for M7 | C. Live API use observed, **T4 FAIL** (balance 0; fractional dollars truncated, now client-rejected). Do not fabricate balance growth or label deposit alone reconciled; distinguish use evidence from failed acceptance. |
| SpacetimeDB | Preserve #43 local T8 module/reducer denial/shared-policy bundling and 20/20 subscription updates; collect full state/adapter/office/parity proof next | C/B/A. Local T8 PASS is real backend feasibility proof. Maincloud 401/full schema/durable adapter remain pending; same-host DOM timing is not avatar or hosted latency. |
| Anthropic | Named community, [two approved owner quotes](owner-quotes.md), successful Claude task trace with audited scope and failure handling | A/D. Catalog listing, model default or failed request is not a successful Claude run. |
| Apify | Public Actor URL/run, real public company source/time/cost, meaningful stop/verify decision; organizer answer on AI Chat requirement | D. T5 latency/cost bar ≤60 s and <$0.10; caches labeled with original time. |
| Microsoft / overall | Honest problem evidence, measured useful work, failure drill, path to production and clear guardrails | All. No production-compliance claim or invented customer validation. |

No x402 claim without the Sat 6 PM stretch gate and private eligibility confirmation; never put eligibility answers in this kit.

## Metrics sheet to fill from complete runs

| Metric | Required reporting format | Value / artifact |
| --- | --- | --- |
| Traps caught | correctly held/escalated planted traps / all planted traps | MISSING |
| False holds | legitimate cases wrongly held / legitimate cases, with case list | MISSING |
| Human approvals per 100 actions | escalations / agent actions ×100; define action once | MISSING |
| Policy violations | count and denominator; link each commitment/payment/payee audit | MISSING; target 0 is not a result |
| Answer-key match | matching final state + required rule IDs / evaluated scenarios | MISSING |
| Disclosure / leakage | compliant calls / calls; leaks before identity / calls | MISSING |
| Routing / cost | local calls / all model calls, p50 by route, estimated cost method, fallback count | Suite MISSING; T10 is five extraction samples/model only |
| Voice and pre-call | p50/p90 turn-end→audio, time-to-ring, p50 pre-call, sample count | MISSING |
| Prompt-only baseline | same selected cases/prompts/model, violations and outcomes, even if 0 | MISSING; do not claim unmeasured improvement |

## Submission gates (PT)

- [ ] **Sat noon:** two real owner/office-manager quotes, permission and approved wording recorded (#32).
- [ ] **Sat 11 AM:** phone core loop with 3D closed; if missed, apply spec §9 cut order.
- [ ] **Sat 6 PM:** stretch gate; **10 PM:** feature freeze; **Sun 1 AM:** code freeze.
- [ ] **Sun 1–3 AM:** actual-run recording plus backup clips, maximum three main takes.
- [ ] **Sun 5–6:30 AM:** three rehearsals, including call-failure and GX10-down drills.
- [ ] **Sun 7 AM:** #31 README kit verified; no unresolved claim placeholders in public copy.
- [ ] Aziz reviews final text, tracks, public repository, Actor/video links and real/sim labels and gives explicit submission OK.
- [ ] **Sun 7:30 AM target:** authorized person submits, captures confirmation and selected tracks; **8:50 AM hard cutoff**.
- [ ] Backup clips on two laptops and a phone; whole team ready for **10:30 AM–12:30 PM** live judging.
