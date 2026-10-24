# Offline agent eval scoreboard

**Synthetic deterministic mock run. These are code-path results, not live model accuracy or production fraud-detection estimates.**

Reproduce from the repo root after `pnpm install --frozen-lockfile`:

```sh
pnpm --filter @backroom/orchestrator exec tsx src/agents/eval/scoreboard.ts
```

Base commit: `c7e9d29b14beeb26eb605b89d1da54d92c4c91e6`. Answer key: northfield-v1; signoff: **approved**.
Frozen manifest verified: 170 files.
Input SHA-256 hashes and item-level observations are in [scoreboard.json](scoreboard.json).

| Measurement | Result |
| --- | --- |
| Extraction field fidelity, fixture-fed mock (8 fields × 83 invoices) | 664/664 (100%) |
| Source/PDF extraction accuracy, GX10 gpt-oss:20b on PDF text (recorded live 2026-10-24; 81/83 invoices exact) | 579/581 (99.66%) |
| Initial AP pay/hold decisions vs key | 10/10 (100%) |
| Vendor fraud catch (lookalike sender only) | 1/1 (100%) |
| Duplicate catch | 1/1 (100%) |
| All keyed AP holds caught | 9/9 (100%) |
| False holds on keyed clean ALLOW steps | 0/1 (0%) |
| Authoritative AP decision rule agreement | 9/9 (100%) |
| Collections pre-call permit agreement | 8/8 (100%) |
| Keyed bank-feed reconciliation agreement | 4/4 (100%) |
| P11 expired memory activation recovery (late tool/cancel and pre-provider fence variants; no OS kill) | 3/3 (100%) |
| AR scripted calls through the Dispatcher (promise, dispute, paid x2, wrong number, opt-out, hostile, human request, voicemail) | 9/9 (100%) |
| Pre-call stops: planner refuses with the key rule, direct dial rejected before the provider (C11, C13-C16, C22) | 6/6 (100%) |
| Demo inbox agent team (production dispatcher, scripted QueryFn, ALLOW cannot pay, seat decision kept, DEMO_AGENTS=0, mismatched origin rejected) | 1/1 (100%) |
| P10 Collections dispatcher tool isolation (not policy rule agreement) | 1/1 (100%) |
| P04 dispatcher bank-change application (software passkey, fixture providers) | 1/1 (100%) |
| P04 missing/denied/spoken approval guards | 3/3 (100%) |
| C5 judge calls: unrecognized ends ESCALATE, tagged scenario_source judge | 7/7 (100%) |
| P12 GX10 cut: same outcome with audited cloud_fallback (mock transport) | 10/10 (100%) |
| Existing eval answer-key checks (partial execution permitted) | 34/34 (100%) |
| Existing eval scenarios with no unexecuted integration step | 22/34 (64.71%) |

## Coverage and limits

- **apItems**: 83
- **arItems**: 10
- **scenarios**: 34
- **apRuntime**: Production ClaudeAgentRuntime + Dispatcher + role registry + handoff store + in-memory usage ledger; injected scripted QueryFn.
- **arRuntime**: Real collections permit and reconciler/auditor DomainTools; direct tool-script seam, not dispatcher or voice conversation.
- **extraction**: Oracle-fed fixture mock; schema and evidence fidelity only. 8 equally weighted fields per AP item; lineItems is one exact-match field; absent optional adjustment matches absent.
- **providers**: Synthetic GX10, bank, CRS public-records and Apify responses. No network calls, keys, real calls or money. Positive runtime cost entries are synthetic accounting tests, not spend.
- **fraudDefinition**: Only key steps with LOOKALIKE_DOMAIN; one planted fraud item. Sanctions and routine bank-change holds are not relabeled fraud.
- **payablesDefinition**: Keyed invoice initial pay/hold decisions and P08 evidence gate; includes P03 sender variants. P04 has a separate two-dispatcher-run bank application measurement. P10 probes Collections tool isolation; NOT_IN_BADGE stays a separate direct policy reference. P11 measures expired memory activation takeover after a persisted mock receipt and with the stale runner parked before payment I/O (synchronous effect fence), not an OS kill or durable restart. P12 replays keyed AP steps of its comparison scenarios with GX10 healthy, then cut, and requires the same outcome vector.
- **recovery**: Production runtime/dispatcher, expired-activation takeover and Payables replay on retained memory state. Scripted query abandoned before provider I/O or after a persisted mock receipt, before handoff/completion; no OS process kill, durable restart, uncertain debit retry or real provider debit.
- **arConversations**: Production collections planner (mock CallStarter), real tool gateway handler/store, production Dispatcher + ClaudeAgentRuntime with scripted QueryFn for post-call, reconciler and auditor. Scripted caller lines and voice-agent tool choices; no Cartesia, phone, model or bank network.
- **judgeCalls**: Judge-tagged call on the real tool gateway handler/store with shared audit mirroring, then production Dispatcher + ClaudeAgentRuntime (scripted QueryFn) post-call. Voice-agent tool choices are scripted; no Cartesia, phone or model. Cases: dispute, wrong_number, unrecognized_request, invented_tool, paid_then_invented, invented_then_paid, opt_out. The opt-out control must not escalate.
- **gx10Failover**: Production Dispatcher/ClaudeAgentRuntime per keyed step, twice on fresh snapshots. Cut run: every GX10 request fails, local_extract falls back once through the production router (createRouter, field_extraction) to a canned Anthropic transport; route, model, latency and synthetic cost are audited as extraction_routed with ROUTE_FALLBACK. Only the document text and extraction schema are sent. No network, key or spend; this is not a live link cut.
- **pdfExtraction**: Text layer of 83 fixture invoice PDFs (pdfium) through the production router local field_extraction route on shared GX10 gpt-oss:20b, production 0.7 confidence gate, cloud fallback refused, a fresh router per document with a 60 s timeout (production uses 8 s and demotes GX10 above a 5 s median; counts reported). Scored 7 document-printed fields per invoice by exact match after cosmetic normalisation; vendorId and bankAccountId are not printed and are resolved by code from the vendor master. Image/vision reading is not measured. Recorded 2026-10-24T18:51:17.743Z at 9a191ff; p50 2850 ms. An earlier attempt hit a ~10 s cold model load, which the production router treats as a GX10 demotion (5 s median) and an 8 s timeout.
- **precallStops**: Production Collections planner tools + ClaudeAgentRuntime (scripted QueryFn tries start_call) and the production dial path createDialCallStarter -> dialCollectionCall over a provider stub. UI call-button state, email-only follow-up, live CRS/Apify evidence and real Cartesia are not executed. Scenarios: C11, C13, C14, C15, C16, C22.
- **inboxTeam**: Production createInboxAgents (ClaudeAgentRuntime, Dispatcher, role registry, memory handoff store) with an injected scripted QueryFn and a mocked CRS vendor port. Completed office rows are the public handoffs. evaluate_invoice may ALLOW; request_payment is the narration hold-only port and cannot pay. DEMO_AGENTS=0 is measured through demoAgentsEnabled, narrateInbox, and the production inbox HTTP entry, which keeps the recorded seat decision and creates no agent case. That HTTP entry reads DEMO_PUBLIC_URL and rejects a mismatched Origin. Its payables seat is forced to VENDOR_CRS=fake for the request and the previous value is restored, so a live setting cannot replace the lookalike hold or place a CRS call. Narration appends its own hold and does not rewrite that seat decision. No Anthropic call, network, or dial. Actual provider spend is 0.
- **badgeAttack**: Production Collections planner + Dispatcher/ClaudeAgentRuntime with scripted QueryFn and real PreToolUse/schema gates. No payment tool or bank adapter is available; no payment execution or human/voice approval is claimed. Policy NOT_IN_BADGE is a separate direct evaluator reference.
- **bankChange**: Scripted QueryFn through production runtime/dispatcher; production VendorSeat/ControllerApprovals; software passkey, fixture CRS/Apify and bank. No human tap or live provider proof.
- **falseHoldDefinition**: Keyed ALLOW invoice steps held / all keyed ALLOW invoice steps. Historical paid invoices excluded from this denominator.
- **unscored**: The 83 raw AP runs and 10 AR runs are coverage, not 93 labeled ground-truth decisions. Only explicit answer-key labels count toward accuracy.

- Every AP invoice runs from a fresh repository snapshot, including historical invoices. Every AR invoice gets a reconciliation trial; every scenario is visited by the existing eval and every collections scenario gets a permit probe.
- Initial AP decisions retain the required legitimate-bank-change hold and do not count it as a false hold. Separately, P04 runs the production runtime/dispatcher before and after VendorSeat applies a ControllerApprovals-verified software passkey receipt on the same repository. This is two cases around a code-owned human boundary, not an autonomous agent approval or human tap. No role was tuned to the key.
- The frozen key has 34 team-authored scenarios and zero external scenarios. Small planted-trap denominators cannot support a general fraud-detection claim.

## Disagreements and unexecuted evidence

- **P03/1:signals**: Tool signal list [] differs from key [BANK_CHANGE_HOLD]; authoritative sealed decision is [BANK_CHANGE_HOLD]. Signal lists and decision rules are distinct.
- **P04/0:signals**: Tool signal list [] differs from key [BANK_CHANGE_HOLD]; authoritative sealed decision is [BANK_CHANGE_HOLD]. Signal lists and decision rules are distinct.
- **P07/0:signals**: Tool signal list [PAYEE_NOT_IN_MASTER,OFAC_STOP] differs from key [OFAC_STOP]; authoritative sealed decision is [OFAC_STOP]. Signal lists and decision rules are distinct.
- **P01**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **P07**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **P11**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **P12:scope**: No keyed AP invoice step to replay for P10; their GX10 failover is not measured here.
- **C05**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C08**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C09**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C13**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C14**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C15**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C17**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **C21**: At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.
- **AR_RUNTIME**: 9 AR conversations (C02, C10, C06, C07, C08, C12, C05, C09, C21) run planner -> real tool gateway -> Dispatcher post-call/reconciler/auditor, with a next-call check after stops and voicemail. Caller lines and voice-agent tool choices are scripted; agent speech (de-escalation, callback wording), Cartesia, live phone and the other collections scenarios are not measured.

## Keyed AP items

| Item | Invoice | Expected | Actual | Exact rule match |
| --- | --- | --- | --- | --- |
| P01/0 | 4401 | ALLOW | ALLOW | true |
| P02/0 | 4419 | HOLD | HOLD | true |
| P03/0 | 4471 | HOLD | HOLD | true |
| P03/1 | 4471 | HOLD | HOLD | true |
| P04/0 | 4480 | HOLD | HOLD | true |
| P05/0 | 4481 | HOLD | HOLD | true |
| P06/0 | 4482 | HOLD | HOLD | true |
| P07/0 | 4483 | HOLD | HOLD | true |
| P08/0 | 4484 | HOLD | HOLD | workflow gate |
| P09/0 | 4485 | HOLD | HOLD | true |
