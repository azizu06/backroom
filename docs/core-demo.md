# What is real in demo:core

Run `pnpm demo:core` from the root. No browser, 3D, credentials, network, or model
inference is needed. `pnpm test` includes the fast deterministic integration run.
This proves the server loop with **scripted call turns**, not the teammate-phone
checkpoint or live sponsor gates.

```text
1042 overdue -> real pre-call pipeline + canCall + envelope
 -> gateway identity guard -> identity confirmed
 -> propose_plan(4, waive fee): DENY / FEES_NON_WAIVABLE
 -> propose_plan(4, retain fee): ESCALATE / MAX_INSTALLMENTS
 -> escalation row + Dana_desk -> real WebAuthn verifier + software test authenticator denies
 -> check_approval -> propose_plan(2, 50/50): ALLOW
 -> stored $2,475 link -> real payment service + Nessie SDK (fake HTTP)
 -> exact reconciliation -> partially_paid -> hash-chain audit + two cited why answers
4471 inbox -> Payables -> LOOKALIKE_DOMAIN -> held/escalated; zero bank effects
 -> corrected-domain defense check still BANK_CHANGE_HOLD
 -> repeat with LLM OFF: same holds, typed LLM_OFF, zero model requests
```

The policy engine returns the first failing rule. Two proposals demonstrate the
fee denial and installment escalation; one proposal does not produce two results.
The trap's bank-change-only check is explicitly hypothetical, after correcting the
sender domain; it never releases the actual lookalike payment.

| Boundary | Real in this command | Fake / remaining integration |
| --- | --- | --- |
| Policy, pre-call, envelope | Exported `@backroom/policy` and `collections/index.ts` pipeline (#17) | CRS/Apify use its exported fake checks; synthetic identity/company, no live sponsor evidence |
| Call plan + router | Real planner and `createRouter().route()` with schema/policy validation | Scripted HTTP response, `model=scripted-fixture`; audit actor `system`, route `test_stub`. No inference or spend |
| Voice (#18) | Real authenticated `web/lib/gateway` HTTP handlers, parser, policy, dedupe and transactional gateway store | Scripted turns; no Cartesia dial, speech, transcript compliance, or delivery provider |
| State (#16) | Real `MemoryStateStore`, leases, invoice transitions, target anchors, hash-chain audit | In process; no SpacetimeDB or restart durability. Gateway audits append directly to the same state chain with their original UUIDs |
| Controller (#20) | Real approval bridge, StateStore escalation/desk target, `ControllerApprovals` registration and signed assertion verification, then gateway `check_approval` | Exported software `TestAuthenticator` supplies P-256 signatures; no human phone/Face ID tap. The recorded human actor describes the verifier contract, not evidence of an actual Dana tap |
| Pay page + bank (#21) | Link amount comes only from the committed ALLOW plan; real `PaymentService` and Nessie SDK | CLI click/email delivery and bank HTTP are simulated. Mobile page: see [M7 setup](m7-payments.md) |
| Reconciliation (#21) | Exported job checks unique deposit ID, exact memo, completed status, amount; reducer transitions + receipt | Balance display uses the SDK's exact API-derived label, never settlement evidence. Seed short/duplicate/already-paid tests fail closed |
| Inbox/payables (#22) | Real `routeInboxItem`, `SeatWorker`, `evaluateStep`, escalation and Dana target | Typed #4471 fixture bypasses email/PDF extraction and the merged PayablesSeat pipeline in this command; no vendor master mutation |
| Ask why (#23) | Real retrieval and cited deterministic templates; `audit_N` maps to StateStore `audit:N` in evidence refs | Explicit offline option; no Claude call or TTS |
| LLM OFF (#47) | Real store switch, router `LLM_OFF`, inbox routing and policy enforcement | No model needed for either typed bank-change run; OFF never simulates a new voice call |

`orchestrator/src/core-demo/` owns these adapters; replace each fake through the
owning module's exported interface as its PR lands. Gateway UUIDs and audit times
can vary across executions; assertions compare outcomes and validate each chain,
not byte-identical logs. The command prints policy quotes, original gateway IDs,
StateStore IDs, `prevHash`/`hash`, fake labels, and two grounded answers.

Opt-in Nessie sandbox run: put
`NESSIE_API_KEY` in root `.env.local` and run `pnpm demo:core --live`. Optionally
set `NESSIE_ACCOUNT_ID`; otherwise the exported client seeds Northfield. It uses
that client's durable claims in `NESSIE_CLAIMS_DIR` or gitignored `.nessie-state/claims`, and
never adds a second HTTP SDK. Missing key/client fails explicitly. The bank is the
only live service in this variant; the controller authenticator, voice, card and
external pre-call checks remain simulated. A failed deposit/feed check exits nonzero. The displayed total uses the exact
API-derived label documented above; an unchanged account balance is not settlement evidence. The T4 balance gate is independently
tracked; a fake-bank pass does not establish it. Do not use `--live` in unit tests.
