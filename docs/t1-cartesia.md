# T1 Cartesia smoke test

Status: **PARTIAL** (2026-10-24, updated 09:50 UTC): the coordinated M4 phone retest rang but both tools failed with HTTP 502 after the private evidence observer crashed the receiver. No successful phone tool round trip is established. See the retest evidence below. Earlier T1 evidence: connected in 8.2 s PASS; actual `call_turn` receipt PASS; phone mid-call tool round trip PENDING. A separate phone-free WebSocket call successfully exercised the real webhook tool within its 2 s timeout. Firstmate explicitly authorized M4 implementation while the coordinated phone retest waits for Aziz (approximately 02:55 AM PT); no redial while he is away.

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

A retest should coordinate with the phone owner to let the disclosure finish and answer the synthetic Jordan identity check, then verify the echo response and a measured Cartesia tool duration. Until then, report T1 as partial; do not represent the tunnel probe as mid-call evidence. M4 may proceed under firstmate's explicit 07:59:41Z instruction; a phone retest is a follow-up.

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

## Sources checked

- [Cal Hacks starter pack](https://docs.cartesia.ai/calhacks)
- [Managed Agents](https://docs.cartesia.ai/agents/introduction), [configuration](https://docs.cartesia.ai/agents/configuration), [models](https://docs.cartesia.ai/agents/models)
- [Webhook tools](https://docs.cartesia.ai/agents/webhook-tools), [call events and deduplication](https://docs.cartesia.ai/line/infrastructure/observability#webhooks)
- [Outbound calls](https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing)
- [Free Cartesia number slots](https://docs.cartesia.ai/line/integrations/telephony/cartesia-numbers), [telephony usage add-on of $0.014/min](https://docs.cartesia.ai/line/integrations/telephony/phone-numbers)

Integration note: Cartesia rejects `constant_value` and `dynamic_variable` parameters listed in a tool schema's `required` array. Only model-supplied parameters belong there. Current API version: `2026-08-14`; managed resources use `/v1/agents`, while calls/numbers/lifecycle webhooks use `/agents/...`.
