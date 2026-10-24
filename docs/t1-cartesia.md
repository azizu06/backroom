# T1 Cartesia smoke test

Status: **PARTIAL M4/M6 acceptance** (2026-10-24, updated after the 19:03–19:07 UTC third coordinated phone retest). The third call demonstrated policy audit before the spoken escalation and a real four-payment `ESCALATE` with an approval link. The request expired as `pending_owner`; no passkey decision or approval relay was recorded. The earlier second call demonstrated fee-waiver DENY, two-payment ALLOW and a queued payment link. Automatic approval delivery and a completed phone approval remain unproven. No automatic redial.

## Original T1 measurements — 07:42–08:06 UTC

| Check | Evidence | Result |
| --- | --- | --- |
| Anthropic in account catalog | `GET /v1/agents/models`, HTTP 200 at 2026-10-24T07:42:19Z; includes `claude-haiku-5.5`, `claude-sonnet-5`, `claude-haiku-4.5`, `claude-sonnet-4.6` | PASS |
| Managed Agent + webhook tool | Created T1 agent using `claude-haiku-5.5`, fixed §1.4 welcome, `t1_echo`, and attached lifecycle webhook | Setup complete |
| Number | Free Cartesia US number provisioned; number itself costs $0; calling usage remains metered | Setup complete |
| Public HTTPS tool route | Cloudflared quick tunnel → local `/api/tools/t1_echo`; authenticated probe HTTP 200, 105 ms; no credentials HTTP 401 | Setup probe only |
| Event route and replay | `/api/voice/cartesia`: authenticated synthetic event HTTP 200, 95 ms; missing secret HTTP 401; retry returned `duplicate: true` | Setup probe only |
| Actual phone ring ≤60 s | Dial request at 07:56:07.594Z; connected call starts 07:56:15.830606Z and contains real caller speech. Time to connection is 8.236 s, an upper bound on ring time; exact observed ring time was not separately recorded | PASS (upper bound) |
| Mid-call tool round trip ≤2 s | No tool invocation in the real call; caller interruptions prevented identity confirmation. Public probe is not a Cartesia mid-call measurement | PENDING / latency unmeasured |
| Actual `call_turn` receipt | First real event received 07:56:17.033Z, Cartesia event time 07:56:17.003135821Z; call `ac_Zk7d1K54Kson8CpMgMmm5J` | PASS |
| Phone-free webhook tool | WebSocket call `ac_bjSC3edtLTKaqj5YJPvetq`, actual `t1_echo` result `ok:true`; tool timeout read back as 2 s | PASS (separate transport) |

Firstmate relayed explicit consent and target-and-go at 07:55:42Z. The destination remains only in `.env.local:T1_DIAL_TO`; the private consent fixture records source/text/timestamp and that env reference. `DEMO_OVERRIDE` was logged because the test was outside calling hours. The call ended with `client_hangup`. The configured fixed welcome was verified via API before dialing, but actual speech was repeatedly interrupted, so full disclosure delivery was **not** demonstrated. No financial amounts were sent to or spoken by the agent. No second call was placed automatically.

At that checkpoint the phone tool check remained partial; subsequent retests are recorded below. The tunnel probe alone did not establish a mid-call measurement.

## Phone-free measurement

At 08:05 UTC a server-minted 120-second agent access token opened the existing Managed Agent's WebSocket session. Local macOS speech said “Yes, this is Jordan. Please run the connectivity check.” after the complete welcome. No microphone or phone was used. The actual HTTPS echo receipt arrived at 08:05:54.972Z; Cartesia's successful tool-result event arrived at 08:05:55.050Z. The previous user-turn-end event arrived at 08:05:54.200Z: the observed user-turn-end → tool-result interval was **850 ms**, including model inference and the tool path. The full response-processing metric `agent_turn_ms` was **1,607.026 ms**; this contains the immediate tool and is a conservative processing-window bound, not an exact HTTP duration. Successful completion under the API-verified **2 s tool timeout** establishes the requested threshold for this WebSocket test. Exact provider HTTP request-start/finish timing was not available (`GET .../logs` returned 404); do not label the 78 ms receiver→result interval as a full round trip.

The WebSocket call delivered five real `call_turn` receipts. Private evidence: `.env.t1/websocket-evidence.json`, `websocket-call.json`, `tool-readback.json`, and the receiver's `receipts.jsonl`. Access-token sessions rejected client-supplied dynamic variables (`dynamic_variables_not_allowed`); the retry omitted them because T1's greeting and echo need none. This does not change outbound PSTN dynamic-variable support, which is configured by the trusted dial request.

Repeat this phone-free test from repo root:

```sh
VOICE_WS_GO=yes node --env-file=.env.local orchestrator/src/voice/ws-smoke.mjs
```

It requires Node 24, macOS `say`, and `ffmpeg`; it records private evidence and exits nonzero if no successful echo result arrives.

## Run

From repo root, copy shared credentials without displaying them:

```sh
ssh gx10 cat /srv/team/backroom.env > .env.local
chmod 600 .env.local
```

Add a generated `CARTESIA_WEBHOOK_SECRET` to the private env. Start the receiver and tunnel in separate terminals:

```sh
node --env-file=.env.local orchestrator/src/voice/t1.mjs serve
cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate
```

Save the tunnel origin as `T1_PUBLIC_URL` in `.env.local`, then run:

```sh
node --env-file=.env.local orchestrator/src/voice/t1.mjs catalog
node --env-file=.env.local orchestrator/src/voice/t1.mjs number
node --env-file=.env.local orchestrator/src/voice/t1.mjs setup
```

Resource IDs, callback number, consent, API errors, and receipts live only in gitignored `.env.t1/`. The dial destination stays only in `.env.local`; the consent fixture references that variable and dial responses omit destination fields. The setup command reuses recorded resources. A changed tunnel requires updating the existing webhook/tool URLs before another call; keep the current receiver and tunnel alive through T1. The receiver logs identifiers/timing only, not speech or destination numbers. Synthetic probes are labeled by their synthetic call ID and do not count as live-call evidence.

**Dial only after firstmate's explicit target-and-go reply.** The opt-in `dial` command requires `T1_DIAL_TO` (US E.164), `T1_DIAL_GO=yes`, `T1_CONSENT_SOURCE`, `T1_CONSENT_TEXT`, `T1_CONSENT_AT` (ISO timestamp), and `T1_B2B_TEST=yes`. Outside weekday 9 AM–6 PM Los Angeles time, also set `DEMO_OVERRIDE=true`; the permit receipt records the override. The target and consent stay in private env/evidence, never this document. T1 is a synthetic Northfield B2B connectivity scenario: it exposes no debt amounts or financial actions. M4 must enforce client-specific policy and identity in its gateway.

```sh
T1_DIAL_GO=yes node --env-file=.env.local orchestrator/src/voice/t1.mjs dial
```

The command stores consent before requesting a call, checks per-destination errors even on HTTP 200, and never automatically retries a dial. Measure actual ring from `dial_requested_at` to the phone owner's ring confirmation. Obtain the Cartesia tool duration from call runtime logs/turn evidence, then record it here alongside an actual `call_turn` receipt. Do not substitute local handler time or `call_started` time for phone ring time.


## Coordinated M4 phone retest — 09:48 UTC

Firstmate relayed fresh authorization at 09:48:05Z with Aziz holding his own phone. Exactly one full M4 dial was run, using the Keychain destination privately, the previously provisioned free T1 number, four distinct server secrets, and a localhost:8788 tunnel. No retry was placed. Aziz confirmed through firstmate that it rang, asked for Jordan, accepted his “yes,” and then reported errors. This was the synthetic invoice scenario, not a real debt or bank action.

| Evidence | Observation | Result |
| --- | --- | --- |
| Phone-free prerequisite | WebSocket `ac_QFWN2QKvMBCnFdPZgywupX`: complete fixed welcome, synthetic Jordan reply, `t1_echo` returned `ok:true`; receiver receipt 09:47:03.872Z, provider tool result 09:47:03.908Z | PASS, separate transport |
| WebSocket timing | Observed user-turn-end receipt 09:47:02.851Z → successful tool-result receipt 09:47:03.908Z = **1,057 ms**; includes inference, not an exact HTTP duration | PASS under configured 2 s tool timeout |
| Phone call | `ac_E1UZuuTZC7eq3fh7sjKD3d`; local session `46082151-8ec6-4389-9b1c-211184c69942` | Connected |
| Permit audit | 09:48:10.137Z `CALL_PERMIT`, rules `IN_BADGE`, `DEMO_OVERRIDE`; consent persisted before provider request | PASS |
| Connection | Provider start 09:48:16.566527Z, **6.429527 s after permit**; Aziz confirmed ring, without an exact ring timestamp | Connection bound only |
| Disclosure | Initial “Hi,” interrupted at call-relative 0.389 s; another assistant turn interrupted at 4.390 s. Uninterrupted replacement at 7.213–15.857 s said “collections assistant” and “may be recorded,” without explicit AI disclosure | FAIL; exact fixed disclosure not completed |
| Caller identity | Final clear “Yes.” at 31.276–32.068 s; agent attempted identity tool at 33.120 s | Caller response captured in provider transcript; gateway confirmation absent |
| `verify_identity_result` | Provider tool id `toolu_01Q1Y2mRXuLp2Jhkym5ZBKVJ`, arguments `result=confirmed`; result: service unavailable **502**, outcome unknown | FAIL; no authenticated relay/gateway receipt |
| `get_invoice_context` | Provider tool id `toolu_014bBx78RkPWvhQc9ZBsAKHL`, at 33.236 s; same **502**, outcome unknown | FAIL; no gateway policy result |
| Other seven tools | Not invoked | Not tested |
| Lifecycle receiver | `call_started` persisted 09:48:17.608Z, event `webhook_HF58nx96eRSrxHQiQNMWPa`; no `call_turn` or completion event persisted as of 09:50 UTC | Phone `call_turn` webhook proof absent; transcript obtained by provider GET |
| Gateway audit/state | Empty tool audit, delivery, plan, escalation, link, and outbox collections; `identityConfirmed=false`; relay `disclosureComplete=false` | No financial action; no tool ALLOW/DENY measured |
| End | 09:48:57.715178Z, `client_hangup` | Completed |

### Diagnosis and correction

The test's temporary, uncommitted HTTP observer caused this failure; it was not an authenticated gateway rejection or a tool timeout. It redacted the entire serialized JSON string with a phone-number regex, which also matched numeric fractional timing values. Parsing the altered JSON threw before the first event response ended. The receiver's error path then attempted headers already sent (`ERR_HTTP_HEADERS_SENT`, `live.ts`), terminating Node after `call_started` had committed. Both subsequent tools reached an unavailable origin through Cloudflare and returned 502. After the call, localhost health failed and public health was 502. The provider transcript records the tool errors; no gateway receipt exists to attribute a policy decision. The agent also attempted the second tool despite the first tool's unknown outcome.

The private observer has been removed from the launch command. The local receiver now records private `http-evidence.jsonl` through `withVoiceEvidence` in `orchestrator/src/voice/evidence.ts`: redact string values only, preserve numeric timings, omit authentication headers/controller requests, and catch evidence parsing/storage errors after response completion. Regression tests reproduce the numeric-corruption exception and a failing log sink, then verify HTTP responses and subsequent health requests survive. All **26 voice tests** and orchestrator typecheck pass. A public unauthenticated tool probe returned 401, followed by public health 200; these probes are not live-call evidence.

Private evidence remains in `.env.t1/` and `.env.voice/` (`websocket-evidence.json`, `provider-call.json`, `audit.jsonl`, `journal.json`, `gateway.json`, `http-evidence.jsonl`). Destination, callback number, credentials, raw provider response and consent stay uncommitted. Aziz deferred the next phone test at 09:52 UTC; the phone retest is **pending a fresh firstmate go**. Task servers and tunnels were shut down. A new phone call requires a new explicit firstmate dial-go. The disclosure deviation remains a separate observed limitation; no guard was relaxed to accept it.

## Second coordinated M4 retest — 13:29 UTC preparation

The phone-free prerequisite initially exposed a separate setup bug: reusing T1 resource IDs did not update either the echo tool URL or lifecycle webhook URL when the tunnel changed. WebSocket call `ac_65oT12akwB9Um4bp62UdZr` completed the fixed disclosure and Jordan reply, but `t1_echo` reported an unreachable service with unknown outcome; the new receiver had no corresponding tool/event receipts. API readback confirmed both URLs differed from the current tunnel. A direct authenticated probe to the new tunnel returned 200, isolating the stale provider configuration.

`t1.mjs setup` now PATCHes reused tool and webhook resources, including authentication, while retaining their IDs; the create-only tool `type` field is omitted on PATCH. A network-mocked CLI regression reproduces the reused-resource setup and asserts both new URLs and secrets are sent without creating resources. Readback after setup confirmed both endpoints matched the new tunnel.

The phone-free rerun `ac_jr6yh9T4d1KxVRgfuBhmhG` completed the exact fixed welcome without interruption, received the synthetic Jordan reply, and returned actual `t1_echo` `ok:true`. User-turn-end receipt at **13:29:16.849Z** to tool-result receipt at **13:29:17.738Z** was **889 ms**, including inference. The receiver recorded the echo at **13:29:17.701Z**. This is separate WebSocket evidence under the configured 2 s tool timeout, not a phone measurement or exact provider HTTP duration. Private failed/successful transcripts remain in `.env.t1/`.

M4 setup completed with nine tools, four distinct secrets, preserved consent, a private Keychain destination, and visible `DEMO_OVERRIDE=true`. Public health returned 200 and an unauthenticated tool request returned 401. All **27 voice tests** and orchestrator typecheck passed. No direct Anthropic key was needed: the managed Cartesia agent uses its configured Anthropic model. Firstmate provided fresh go at 13:31:23Z; exactly one M4 phone dial followed. No second phone dial was placed.

### Phone result — 13:31–13:34 UTC

Firstmate relayed that Aziz was holding the phone and would answer as Jordan, request a fee waiver/four installments, and accept two. At 13:34:33Z firstmate confirmed Aziz said the call was done. The worker did not listen to the handset; the speech account below comes from Cartesia's full GET call transcript, cross-checked against authenticated lifecycle and tool receipts. Destination and callback numbers are redacted.

Call **`ac_hMadmVGvdQq5s6DNekURX4`**, local session `d606cc29-452a-40d1-8b59-321c2ffdcd35`. Permit persisted **13:31:32.690Z** (`IN_BADGE`, `DEMO_OVERRIDE`); provider start **13:31:37.986525Z** (5.297 s later, a connection bound, not an exact observed ring time). Consent was saved before dial. Completion was **13:34:06.542801Z**, `completed`, `agent_hangup`; the lifecycle completion receipt returned 200 at **13:34:06.704Z**.

| Step | Actual receipt and policy/state result |
| --- | --- |
| Disclosure | Complete exact fixed welcome, uninterrupted, call-relative **0.223–8.708 s**. Lifecycle received **13:31:47.563Z**, HTTP 200; `disclosureComplete=true`. Includes explicit AI, Northfield Studio, recording notice and Jordan question. |
| Identity | Caller “Yes.” at **10.268–10.744 s**, after disclosure. `verify_identity_result` **13:31:50.182Z**, HTTP 200, `RECORDED`; gateway `identityConfirmed=true`. Audit `447a2345-12fd-4937-9361-1472179533d4`, `IDENTITY_RESULT`, actor `code`. |
| Invoice context | `get_invoice_context` **13:31:50.853Z**, HTTP 200, `CONTEXT`, invoice 1042, **495000 cents**. No separate context audit row is emitted by this gateway; the authenticated receipt and provider result prove it ran after identity. First amount speech starts **12.987 s**. |
| Fee-waiver proposal | `propose_plan` **13:32:50.682Z**, HTTP 200: **2 installments, 50% first, 30 days, waive_fee=true, discount_pct=0** → `DENY`, `FEES_NON_WAIVABLE`, `can_confirm=false`. Audit `37949157-5a09-4218-875a-f08183306ae1`, policy quote NF-015, actor `code`. Agent then says it cannot waive the fee. |
| Four-payment proposal | **Absent.** No `installments=4` tool request, no `MAX_INSTALLMENTS` result, no escalation row, no `check_approval`, and no passkey decision. Cannot claim this acceptance check passed. See exact transcript excerpts below. |
| Allowed proposal | `propose_plan` **13:33:07.253Z**, HTTP 200: **2 installments, 50% first, 30 days, waive_fee=false, discount_pct=0** → `ALLOW`, `IN_BADGE`, `can_confirm=true`. Audit `5733de74-2ec4-4911-ae0d-807b64c06ecc`, actor `code`. Only saved plan: `f7ff8a23-9396-468b-a12f-9a5500b4d4f8`, total **495000 cents**, first **247500 cents**. |
| Link | After caller reconfirmed, `send_payment_link` **13:33:40.810Z**, HTTP 200, `RECORDED`; gateway audit **ALLOW**, `IN_BADGE`, id `f4f65164-6f34-4edf-afcc-8dc79aa03b2b`, actor `code`. One stored link `32550515-b567-4bd1-a05d-6415c7966760` and one outbox item, **247500 cents**. It was queued, not sent to the phone. |
| Spoken close | Agent repeated two payments of $2,475, fee retained, correctly said link “queued for delivery,” gave callback **[REDACTED_NUMBER]**, and ended normally. No spoken claim of fee waiver, four-payment approval, delivered link or bank payment. |

All five real gateway requests returned HTTP 200 and their success results appear in Cartesia's transcript. Local handler times were **2.689, 3.314, 5.815, 1.375, and 2.670 ms** respectively; these are **not full provider round-trip latencies**. Tools completed successfully under their configured 2 s timeout. No exact provider HTTP duration was exposed. Health after the call returned 200. The gateway has four audit rows (identity, denied plan, allowed plan, link), five dedupe deliveries, one allowed plan, one link, one outbox item, zero escalations, and no bank payment.

### Spoken negotiation gap and correction

Relevant provider transcript, kept verbatim for the ambiguous installment wording:

- **23.234–30.908 s, caller:** “Um, I would like to skip this payment or split it among multiple payments, but don't want to pay now.”
- **32.037–44.039 s, agent:** “I can look at a payment plan, but I can't skip the payment entirely. The most I can offer is two installments, with at least half due first and the full balance within 30 days. Would you like me to check whether that works?” **No `propose_plan` had run.**
- **49.459–58.984 s, agent:** asks for installments “up to two” and first payment “at least half,” again before a proposal tool.
- **61.633–70.904 s, caller:** “Yes, I'll pay at least half and expect uh accept the 2 payment option, but before that you said it's not possible. Can I try waving the fee and paying for?”
- The next tool submitted **two**, not four, with `waive_fee=true`; the gateway denied the waiver. The agent then offered two without the waiver, got caller agreement, submitted it, and received ALLOW.

The transcript does not establish an unambiguous request for **four**; it renders the ending as “paying for?”. It does establish a verbal policy decision and negotiation before the required tool. The managed prompt now explicitly requires `propose_plan` before offering, refusing or negotiating terms, submits requested terms even outside the envelope (including four installments and waivers), forbids silently replacing them with two, and asks for clarification of “for”/“four” or missing fields. Stop requests still take priority. A configuration regression locks down these instructions. This is prompt guidance; code continues to enforce financial authority, and no prompt test proves future live speech. Setup updated the managed agent after the call, and API readback confirmed the revised instructions. At that checkpoint the revised prompt had **not been phone-retested**; the third coordinated retest below subsequently demonstrated four-payment escalation, with passkey approval still incomplete.

### Lifecycle failure and correction

Tool-only assistant `call_turn` ids **3, 4, 12, 15, 20, 24** contained `tool_calls` and no `text`. The event parser required every turn to have string text and returned **400 `INVALID_TURN`** for all six, including `end_call`. These are separate lifecycle acknowledgments, not failed gateway tools: their associated financial tool requests all returned 200 and committed. The receiver did not crash; normal speech turns and completion persisted.

The parser now acknowledges/deduplicates assistant tool-only turns without deriving disclosure or identity from tool claims. Missing caller text and assistant turns lacking both text and tool calls still fail. A regression reproduced HTTP 400 before the fix, then verified 200/dedupe and that disclosure/identity gates stay closed. This fix was applied **after** the second phone call; the third retest below subsequently observed HTTP 200 for its tool-only turns. Final validation: **29 voice tests** and orchestrator typecheck pass (three added regressions: reused T1 setup, tool-only lifecycle turn, negotiation prompt).

### Delivery gap observed during this retest

The follow-up shared-host implementation, QR component contract, expiry rules and headless real-Nessie evidence are documented in [payment-delivery.md](payment-delivery.md). The observations below describe the original call and remain historical evidence, not the current runtime wiring.

At the time of this retest, the local M4 runtime (`orchestrator/src/voice/live.ts` + `LocalGatewayStore`) writes the authorized link path and `send_payment_link` outbox item into private `.env.voice/gateway.json`. It has **no outbox delivery consumer, SMS/email transport, public pay-page host, or QR/short-URL handoff**. The caller heard “queued”; no phone delivery receipt exists.

The repo has a Next `/pay/[linkId]` page and payment authorization lookup, but that runtime reads `getGatewayStore()` in the web process. It does **not automatically read this voice-local file store**. A usable demo handoff first needs a public HTTPS pay origin backed by the same authorized link state. A QR on the demo screen or a spoken short URL can then take the caller there without an SMS provider; neither is wired for this call. Automatic phone delivery would additionally need an outbox worker, a verified contact and consent, an SMS provider/channel, and a persisted delivery result. No provider was added or paid message sent in this task. Payment/reconciliation was not tested.

Private evidence: `.env.voice/provider-call.json`, `http-evidence.jsonl`, `gateway.json`, `journal.json`, `audit.jsonl`, consent file; `.env.t1/retest2-ws-stale-endpoint.json` and successful `websocket-evidence.json`. Raw transcript/provider metadata, destination, callback, credentials and consent remain uncommitted. Task receiver/tunnel are shut down after evidence collection. Fresh firstmate go is required for any additional dial.

## Third coordinated phone retest — 19:03–19:07 UTC

Firstmate relayed fresh go at 12:02 PT with Aziz holding his phone. Exactly one dial was placed; no retry or redial. The worker did not listen to the handset: the speech account comes from the full provider transcript, matched to authenticated receiver/gateway receipts. See the [redacted machine-readable receipt](evidence/phone-retest3/receipt.json) for all 85 transcript records, every tool input/result, the actual escalation view and call-related audit rows.

The tested code was main commit `7f8ff937bdc2c951f93fa579308c01e562404aac`. Setup followed `demo:up`, `demo:reset` and `demo:preflight`, with an owned HTTPS host, memory StateStore and mock bank. Orchestrator, web, Cartesia and GX10 checks were GREEN; Spacetime was RED/unused and Nessie RED/unconfigured. This was a phone/approval rehearsal, not an all-dependency readiness claim. The phone-free WebSocket prerequisite `ac_Q5GNmeguX4dAhnKAN7RF4Z` returned actual `t1_echo` success. API readback confirmed Haiku 5.5, nine tools and the policy-before-speech prompt. This call used Cartesia Managed Agent; it did not exercise the separate Claude Agent SDK dispatcher.

Before dialing, Aziz reported enrolling with Face ID on his iPhone; the public controller endpoint independently returned HTTP 200, `registered=true`. Registration alone does not establish an approval decision.

Call **`ac_aAozkPAUE8RwpuegP2ymjf`**, gateway session `ea5f9fdd-ee4e-4e37-a072-6adb7606844e`. Provider start **19:03:00.932282Z**, end **19:07:36.614343Z**, duration **275.682061 s**, `completed`, `client_hangup`. There is no separately measured phone-ring timestamp.

| Check | Actual observation | Result |
| --- | --- | --- |
| Disclosure | Exact AI/business/recording/Jordan welcome, uninterrupted, relative 0.215–8.536 s; lifecycle HTTP 200 | PASS |
| Identity before amount | “Yeah, this is Jordan.” was not accepted by the exact phrase allowlist; context remained DENY. A second “Yes.” succeeded; amount speech began at 27.827 s | Gate held; natural-language parsing gap |
| Policy before spoken outcome | `propose_plan` at relative 55.453 s; policy audit `7957532f-c8b6-497a-a0a3-8adaff08ef44`, seq 112, persisted at 19:03:57.169Z. Spoken escalation starts at 56.443 s | PASS; neutral clarification preceded the tool |
| Four payments | Actual arguments: 4 installments, 50% first, 30 days, fee retained, no discount. Response ESCALATE/MAX_INSTALLMENTS, `can_confirm=false` | PASS |
| Escalation/link | `3c5a4bde-adc3-4e08-8e76-c52b4a830795`, created 19:03:57.168Z, `/approve/3c5a4bde-adc3-4e08-8e76-c52b4a830795`; operator monitor relayed the full HTTPS URL | Created; automatic phone delivery unproven |
| Passkey result | Expired 19:04:57.168Z; final view `pending_owner`, no decision/method/decidedAt; no human `decide_escalation` audit | NOT ACHIEVED |
| Same-call resend | Caller asked twice. Agent checked the old id once, received `pending_owner`, then said it could not resend. No second `propose_plan` or new escalation | Recovery gap |
| Shared audit | Five relevant rows, including escalation creation and timeout; complete running-server snapshot verified valid at length 113 | PASS; receipt contains only relevant rows |
| Tool-only lifecycle | All 45 `call_turn` receipts returned HTTP 200, including seven tool-only turns; start/completed/analysis also 200 | Prior tool-only 400 regression not observed |

Every tool request returned HTTP 200. These receiver durations include the local bridge/gateway path, not the full provider round trip:

| UTC receipt | Tool | Gateway result | Receiver ms |
| --- | --- | --- | ---: |
| 19:03:13.801 | `verify_identity_result` | RECORDED; actual phrase classified uncertain | 14.426 |
| 19:03:15.317 | `get_invoice_context` | DENY / IDENTITY_REQUIRED | 3.658 |
| 19:03:28.445 | `verify_identity_result` | RECORDED; affirmative accepted | 11.104 |
| 19:03:28.567 | `get_invoice_context` | CONTEXT / 495000 cents | 5.549 |
| 19:03:57.165 | `propose_plan` | ESCALATE / MAX_INSTALLMENTS / approval_path | 5.442 |
| 19:03:58.399 | `check_approval` | PENDING | 3.554 |
| 19:06:37.016 | `check_approval` | RECORDED / pending_owner / “Dana will confirm by email today.” | 8.289 |

The agent told the caller the four-payment request needed controller approval. When asked whether it was sending a phone link, it said it was not sending anything and could not approve itself. After expiry, caller turn 39 asked “Can you uh send the 4 payment plan approval again?” The agent checked the expired id and then said it could not resend. Turn 43 repeated the request; the next reply again refused without a tool call. Those are recorded speech, not a gateway rejection of a new proposal. No payment plan was committed, payment link requested, bank operation performed, or email-delivery receipt recorded.

### Why the expired approval was not resent

At the tested commit, `check_approval` only reads the existing request. The approval bridge expires it and copies its status into the gateway; the gateway's `pending_owner` speech template says “Dana will confirm by email today.” The managed prompt tells the agent to check approval, but defines no expired-request recovery or approval-notification workflow. The model's “cannot resend” claim was not returned by a new-proposal tool.

A phone-free, in-memory replay through the real HTTP gateway/approval bridge confirmed: submit four payments → ESCALATE; advance 60 s → old `pending_owner`; submit the same terms with a fresh webhook request id → **new ESCALATE, different id and approval path**. No idempotency or stale-nonce error occurred in the live call. This establishes existing mechanics, not a product decision to restart timed-out reviews automatically.

Approval creation returned a **relative path**. This rehearsal's monitor prefixed the public HTTPS origin and passed the link to firstmate for manual relay. The controller setup page enrolled the passkey but did not list pending requests. The tested office rendered escalation folder/status, with no automatic approval-link handoff; memory-mode office remained a labeled preview. No automatic approval push/SMS/email delivery was wired along this path. The separately seeded URL printed by `demo:reset` was not this live-call request. Reliable approval discovery and expiry/re-request behavior require their own fixes; this receipt changes no runtime code.

The approval view and full audit snapshot were saved before the required shutdown. The raw process-local GatewayCall was not exported, so there is no preserved raw gateway-store snapshot; the receipt retains all seven actual tool inputs/results and the actual escalation row. No phone-browser POST trace was captured, so this evidence cannot identify a particular WebAuthn error or prove that an assertion was submitted. The owned server and tunnel were stopped. Another phone call requires fresh go in a new task.

At [Cartesia's published rates](https://www.cartesia.ai/pricing), checked Oct 24, 2026, 275.682061 seconds × ($0.06 agent + $0.014 telephony)/minute estimates **$0.340008** for this call, plus approximately **$0.055** for the 55-second WebSocket prerequisite. GET call exposes no billed-cost field; API-created-agent LLM charges and rounding are not included, so the complete billed total and full <$1 ceiling are not independently verified. No direct Anthropic SDK inference ran, and no billing change was made.

## Sources checked

- [Cal Hacks starter pack](https://docs.cartesia.ai/calhacks)
- [Managed Agents](https://docs.cartesia.ai/agents/introduction), [configuration](https://docs.cartesia.ai/agents/configuration), [models](https://docs.cartesia.ai/agents/models)
- [Webhook tools](https://docs.cartesia.ai/agents/webhook-tools), [call events and deduplication](https://docs.cartesia.ai/line/infrastructure/observability#webhooks)
- [Outbound calls](https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing)
- [Free Cartesia number slots](https://docs.cartesia.ai/line/integrations/telephony/cartesia-numbers), [telephony usage add-on of $0.014/min](https://docs.cartesia.ai/line/integrations/telephony/phone-numbers)

Integration note: Cartesia rejects `constant_value` and `dynamic_variable` parameters listed in a tool schema's `required` array. Only model-supplied parameters belong there. Current API version: `2026-08-14`; managed resources use `/v1/agents`, while calls/numbers/lifecycle webhooks use `/agents/...`.
