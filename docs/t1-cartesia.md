# T1 Cartesia smoke test

Status: **FAIL — first attempt did not exercise the mid-call tool** (2026-10-24). M4 implementation remains gated on a real T1 pass. The phone and event delivery worked; a coordinated retest is needed before calling this a platform go/no-go failure.

| Check | Evidence | Result |
| --- | --- | --- |
| Anthropic in account catalog | `GET /v1/agents/models`, HTTP 200 at 2026-10-24T07:42:19Z; includes `claude-haiku-5.5`, `claude-sonnet-5`, `claude-haiku-4.5`, `claude-sonnet-4.6` | PASS |
| Managed Agent + webhook tool | Created T1 agent using `claude-haiku-5.5`, fixed §1.4 welcome, `t1_echo`, and attached lifecycle webhook | Setup complete |
| Number | Free Cartesia US number provisioned; number itself costs $0; calling usage remains metered | Setup complete |
| Public HTTPS tool route | Cloudflared quick tunnel → local `/api/tools/t1_echo`; authenticated probe HTTP 200, 105 ms; no credentials HTTP 401 | Setup probe only |
| Event route and replay | `/api/voice/cartesia`: authenticated synthetic event HTTP 200, 95 ms; missing secret HTTP 401; retry returned `duplicate: true` | Setup probe only |
| Actual phone ring ≤60 s | Dial request at 07:56:07.594Z; connected call starts 07:56:15.830606Z and contains real caller speech. Time to connection is 8.236 s, an upper bound on ring time; exact observed ring time was not separately recorded | PASS (upper bound) |
| Mid-call tool round trip ≤2 s | No tool invocation in the real call; caller interruptions prevented identity confirmation. Public probe is not a Cartesia mid-call measurement | FAIL / latency unmeasured |
| Actual `call_turn` receipt | First real event received 07:56:17.033Z, Cartesia event time 07:56:17.003135821Z; call `ac_Zk7d1K54Kson8CpMgMmm5J` | PASS |

Firstmate relayed explicit consent and target-and-go at 07:55:42Z. The destination remains only in `.env.local:T1_DIAL_TO`; the private consent fixture records source/text/timestamp and that env reference. `DEMO_OVERRIDE` was logged because the test was outside calling hours. The call ended with `client_hangup`. The configured fixed welcome was verified via API before dialing, but actual speech was repeatedly interrupted, so full disclosure delivery was **not** demonstrated. No financial amounts were sent to or spoken by the agent. No second call was placed automatically.

A retest should coordinate with the phone owner to let the disclosure finish and answer the synthetic Jordan identity check, then verify the echo response and a measured Cartesia tool duration. Until then, report T1 as failed/incomplete and keep M4 gated; do not represent the tunnel probe as mid-call evidence.

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
node --env-file=.env.local orchestrator/src/voice/t1.mjs dial
```

The command stores consent before requesting a call, checks per-destination errors even on HTTP 200, and never automatically retries a dial. Measure actual ring from `dial_requested_at` to the phone owner's ring confirmation. Obtain the Cartesia tool duration from call runtime logs/turn evidence, then record it here alongside an actual `call_turn` receipt. Do not substitute local handler time or `call_started` time for phone ring time.

## Sources checked

- [Cal Hacks starter pack](https://docs.cartesia.ai/calhacks)
- [Managed Agents](https://docs.cartesia.ai/agents/introduction), [configuration](https://docs.cartesia.ai/agents/configuration), [models](https://docs.cartesia.ai/agents/models)
- [Webhook tools](https://docs.cartesia.ai/agents/webhook-tools), [call events and deduplication](https://docs.cartesia.ai/line/infrastructure/observability#webhooks)
- [Outbound calls](https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing)
- [Free Cartesia number slots](https://docs.cartesia.ai/line/integrations/telephony/cartesia-numbers), [telephony usage add-on of $0.014/min](https://docs.cartesia.ai/line/integrations/telephony/phone-numbers)

Integration note: Cartesia rejects `constant_value` and `dynamic_variable` parameters listed in a tool schema's `required` array. Only model-supplied parameters belong there. Current API version: `2026-08-14`; managed resources use `/v1/agents`, while calls/numbers/lifecycle webhooks use `/agents/...`.
