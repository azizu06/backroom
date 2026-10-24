# Sponsor README sections — draft for owner verification

**Internal draft for #31.** Implementation snapshot: Sat Oct 24, 2026, reviewed local base `fbca2db`. Features marked pending must be verified against the final revision before these sections move to the root README. Sponsor requirements here come from spec §5 and need final confirmation against current event briefs.

## What is real, sandboxed, synthetic, or pending?

| Component / data | Classification | Evidence now / exact label to show |
| --- | --- | --- |
| Policy evaluator | Implemented deterministic TypeScript | Merged #38, `policy/README.md`; unit behavior is distinct from runtime enforcement. |
| Ask-why service | Implemented server module; synthetic audit input | Merged #35, `orchestrator/src/why/README.md`; synthetic projections in `fixtures/why/`, not signed live state. Responses may be code templates. |
| Northfield Studio, Dana, clients, vendors, invoices, emails and traps | Synthetic demo company/data | Label **SYNTHETIC COMPANY & INVOICES**. Never present the persona as an interview participant or the balances as real money. |
| Cartesia voice call / webhook stream | Setup only; live call unverified | Label **LIVE CALL** only while a real call is active. Otherwise **TEXT SIMULATION** or **REPLAY — recorded [time, call ID]**. Merged #36 is gateway HTTP tests, not phone evidence; T1 has no live dial. |
| GX10 extraction | Reported real model inference on synthetic input | Open PR #40 reports 5/5 exact/schema-valid optimized outputs per model: 20B p50 1.885 s; Qwen 8B p50 2.462 s. Not general accuracy or full-suite share. |
| Claude / OpenRouter | Live success unverified in reviewed evidence | Router smoke reached HTTP 402. Mocked cloud fallback passes; no claim of successful live fallback or Monday readiness. |
| CRS | Proposed server client; live sandbox products unverified | Open #41 reports 13 synthetic boundary tests; product routes/identities await sponsor confirmation. **CRS SANDBOX — test identity [ID]** only with an approved mapping. Never describe a test result as the real company's credit or sanctions status. |
| Apify | Intended real public-web input; T5 in progress (#6) | **LIVE PUBLIC WEB — [URL], observed [time]**, or **CACHED — observed [time]** after a verified run. No published Actor/run linked yet. |
| Nessie bank | Observed live sandbox API use; T4 balance acceptance FAILED | Open #42 reports customer/checking creation, deposits and balance/feed reads. Hosted balance stayed **0** after a completed whole-dollar deposit; $1.25 was stored as 1 and fractional dollars are now client-rejected. Show **NESSIE SANDBOX BANK; SIMULATED CARD — BALANCE EXCEPTION**. No reconciliation or balance-growth claim from deposit alone; no real money settlement. A local substitute must say **MOCK BANK**. |
| SpacetimeDB | Observed local T8 PASS; full application state pending | Open #43 reports shared-policy bundling, rejected forbidden reducer write and 20/20 browser DOM subscription updates (2–5 ms, same host). Label **LOCAL SPACETIMEDB T8**. Maincloud publish failed 401 InvalidSignature; full schema/durable adapter and office integration remain pending. Merged #37's in-memory store is a separate test implementation. |
| Office and passkey approval | Intended live view / human authentication | Reviewed office is a placeholder cube. No row-driven movement, passkey verification or same-call approval proof yet. |

Always show the labels during the run and in video. A cache can aid continuity but cannot prove an integration ran live. A recording is a replay even when it drives the same office events.

## Cartesia: setup, features, limitations

Backroom is designed around a live collections conversation. Cartesia's intended role is the Managed Agent call runtime, turn-taking and tool requests; optional ask-why speech also uses Cartesia output. The deterministic policy service controls permissions, amounts and escalation. **The reviewed repository has not yet demonstrated a live Cartesia call.**

### Setup draft

1. From the repository, use Node 20+ and the pinned pnpm version in `package.json`; run `pnpm install`. Copy `.env.example` to a gitignored `.env` and populate needed values privately. Names include `CARTESIA_API_KEY` and `TOOL_GATEWAY_SECRET`; no credential belongs in the browser, screenshots or this README. Run `pnpm dev:web` for the local web app. This currently starts the scaffold, not a complete call system.
2. A owner must configure a Cartesia Managed Agent and calling number, record the exact supported model from the live catalog, and document the tested dial command/UI. **MISSING:** agent configuration export with secrets removed, model ID, approved calling setup and working end-to-end startup instructions. An Anthropic in-call model is conditional on catalog availability; don't infer it from our OpenRouter defaults.
3. After gateway #36 is integrated, expose the tested HTTPS deployment/tunnel and configure bearer authentication. Bind the nine named tools below to `/api/tools/[tool]`. Use trusted `call_id` and retry-stable `webhook_request_id` fields exactly as the merged gateway schema requires. Verify actual Cartesia delivery against that schema; don't assume its body envelope.
4. Install the durable call/invoice state adapter and outbox consumer before showing payment-link delivery. Load trusted principal/fee, identity, policy version and risk state on the server. The merged gateway's empty single-process memory store is insufficient for deployed durable state.
5. Use a consenting teammate's US phone first. A stored consent record, business-only target, permitted call window and current stop flags must pass before dialing. The opening must identify AI and business, give the recording notice and request identity; invoice amounts stay hidden before identity. Persist opt-out/dispute/handoff and stop on bankruptcy. Use a visible, logged `DEMO_OVERRIDE` for Sunday hours, without bypassing consent or other stop rules.
6. Capture T1: ring within 60 s, authenticated mid-call tool round trip within 2 s, `call_turn` receipt, model catalog evidence and disclosure transcript. Test barge-in, replayed webhooks, invalid auth, identity refusal and voice approval injection. Save redacted IDs/timings and the consenting recording, not tokens or private phone numbers.

| Tool | Intended behavior |
| --- | --- |
| `get_invoice_context`, `verify_identity_result` | Withhold invoice detail until identity is confirmed; record trusted identity state. |
| `propose_plan` | Validate plan; only a matching persisted ALLOW permits spoken confirmation. |
| `check_approval` | Read controller decision; speech cannot create approval. |
| `send_payment_link` | Recheck current policy and stored ALLOW plan; queue fixed amount. Queueing is not delivery. |
| `mark_dispute`, `record_opt_out`, `request_human`, `report_already_paid` | Persist stop or exception path; available even before identity as appropriate. |

**Features supported by component evidence:** merged policy produces rule IDs, exact policy quotes and versioned decisions; merged gateway #36 reports authenticated/validated tools, identity gates, transactional deduplication and real-evaluator tests. **Pending live features:** outbound call, barge-in, turn stream, walk-to-desk relay, passkey decision, actual payment-link delivery and ask-why TTS. T1 is setup only with no live dial. Confirm each before removing this distinction.

**Limitations:** B2B demo only, consenting test recipient, no voice cloning or voice approvals; intended US-phone path awaits T1. No verified latency/compliance rate for real calls. Live cloud requests currently face HTTP 402. No actual card/ACH rail; bank balance is sandbox data. Production requires validated consent/recording practices, durable state/authentication, monitoring and operational review; this prototype is not a claim of legal compliance.

## SpacetimeDB architecture note

The proposed architecture makes the office a subscriber to server state. The renderer animates an `agent.targetAnchor` change after a persisted escalation; it never authorizes a payment, approves an exception or determines a policy outcome. Human UI actions go through authenticated server/reducer paths.

```text
office subscriptions <- state tables/reducers <- server orchestrator + policy
human passkey action -> verified approval path -> escalation decision
voice tools -> authenticated gateway -> policy + durable state
orchestrator -> CRS / Apify / Cartesia / Nessie, then state receipts
```

Spec §4.7 proposes versioned policy/badges/rooms, agents/humans, leased tasks, escalations, inbox/client/vendor/invoice records, calls/turns, signals, bank transactions and an append-only audit chain. Reducers are the state writers. External I/O belongs in the orchestrator; do not describe network effects as transactional database operations. `evaluate` must run with fresh trusted state before effects. Open [PR #43](https://github.com/azizu06/backroom/pull/43) reports that the actual shared policy bundles into the local T8 module and rejects the forbidden collections→payables write without changing the row.

Merged worker PR #37 supplies an async `StateStore` contract, fencing tokens, lease/heartbeat behavior, policy audit and fake external effects. Its in-memory store and fake payment receipts demonstrate a seam, not SpacetimeDB persistence, provider idempotency or process-restart durability. PR #43 advances the earlier placeholder: local publication, agent reducer rejection and browser subscriptions passed. Its 20/20 fresh row updates reached the DOM in 2–5 ms (median 4 ms, p95 5 ms), using same-host clocks; this does not measure physical display, avatar movement or hosted latency.

**Remaining architecture proof:** Maincloud authentication/deployment (publish returned 401 InvalidSignature), full §4.7 schema, durable StateStore adapter wiring, passkey approval, provider payment deduplication, office row→walk timing, hash-chain wall signal and 3D-closed parity. Local T8 has passed and should not be described as unknown; it is still a small feasibility module, not the full approval/state system. If the final chosen backend changes, update its track claim and this section to the actual implementation.

## CRS data-handling note

CRS is intended to supply business-credit/OFAC signals from the sandbox. Only sponsor-approved test identities may be sent. Maintain an explicit mapping from a synthetic client/vendor ID to a CRS test identity. Apify's real public company is a separate input: the two identities are not the same business. Display the sandbox ID and source/time on each CRS result.

The intended handling boundary is server-only credentials; sanitized typed summaries plus a response hash, provider request reference and observation time; no raw response or credential in a public fixture, audit explanation, board post or video. Pass only needed typed signal fields into policy/model contexts. A CRS sandbox OFAC flag can exercise a code stop without asserting anything about a real person or company. Public-web text is data and cannot grant permissions.

Open [PR #41](https://github.com/azizu06/backroom/pull/41) proposes approved-identity enforcement, typed projection and SHA-256 evidence, and reports 13 boundary tests. Its product adapters use synthetic contract tests; actual business-credit/standalone-OFAC routes, request bodies and test identities await sponsor email/Postman confirmation. It is not wired into a worker and does not claim live T3 success. Unknown OFAC output must remain unknown, not clearance. It also proposes `CRS_USERNAME`/`CRS_PASSWORD` instead of the base's client-ID/secret names; use the final merged integration README for setup.

**Verification pending with stream C:** approved identity list, successful credit + OFAC request receipts, any approved OFAC-hit identity, exact stored/forwarded fields, access control, raw-payload logging suppression, retention/deletion settings and account authorization. Do not claim that retention controls or deployed redaction are implemented until inspected. Use a synthetic fixture labeled as such if no hit identity is available; it is not live CRS proof. Avoid showing personal test fields in recordings even when the sandbox supplies them.
