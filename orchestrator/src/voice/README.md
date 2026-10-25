# Managed collections voice (#3, #18)

All code is server-side. `index.ts` is the dial seam; `tools.ts` provisions the
Managed Agent and all nine schemas; `server.ts` receives authenticated call events
and relays tools to the existing gateway. `live.ts` is an opt-in local demo.
No import, setup, or server start places a call.

```text
trusted client + consent + local time
  → policy.evaluate(call_client) → persist CALL_PERMIT / DEMO_OVERRIDE
  → register server session + gateway invoice (identity=false)
  → Cartesia dial (names, invoice ID, envelope; no balance/fee)
  → call_turn: complete disclosure → natural caller identity evidence
  → nine authenticated webhook tools → existing tool gateway → policy
```

`dialCollectionCall` refuses missing/mismatched/future consent, consumer clients,
DNC, risk stops, bad US E.164 numbers, and out-of-window calls. It computes the
client's IANA-local weekday/hour. `DEMO_OVERRIDE` requires both explicit server
enablement and a visible indicator; the permit must be persisted before dialing.
Call `prepare` to register trusted invoice/client state and consent before any
provider request. The local entrypoint does this itself; application adapters must
implement the same contract. HTTP errors and per-destination errors inside HTTP
200 both fail; ambiguous dials are never automatically retried.

Only the invoice identifier and policy's `computeEnvelope` summary enter dynamic
variables. Amounts live in the gateway and are unavailable until identity is
confirmed. The relay keeps every non-empty caller turn since the identity question
was last asked (barge-in included) and, when `ANTHROPIC_API_KEY` is set, has
`answer.ts` interpret them against that question (`affirm`/`deny`/`provide_value`/
`unclear`, Haiku, 2.5 s bound). Code maps that to the identity result: a clear
spoken no always wins, and a model failure falls back to a code-only yes/no
reading. The agent's own `result` claim never counts. The first unclear answer
returns `next_step: ask_again_once`; the second returns `offer_callback_and_end`
and stops the call. `answer-eval.ts` is the opt-in live matrix
(`VOICE_ANSWER_EVAL=yes`). Webhook tools use an 8 s deadline: 2 s dropped both
identity deliveries on the 2026-10-25 venue call before they reached the relay.

## Disclosure, stops, and retries

The current [Managed Agent schema](https://docs.cartesia.ai/api-reference/agents/create)
and [configuration docs](https://docs.cartesia.ai/agents/configuration) expose no
non-interruptible welcome setting. The non-interruptible message documented under
[system tools](https://docs.cartesia.ai/agents/system-tools) applies to voicemail
detection. We therefore configure the fixed disclosure first, ask the agent to
repeat it when interrupted, and deny identity/invoice tools until a complete,
uninterrupted matching assistant `call_turn` is received. Real speech/disclosure
delivery remains a live-eval check; do not claim the prompt alone proves it.

Caller opt-out/bankruptcy terms in actual user turns trigger a gateway stop in
code, even before disclosure. The stopped relay refuses subsequent finance tools.
The local adapter persists these client stops across calls/restarts. Gateway
disputes/already-paid/human requests also stop collection. Approvals remain in
the existing gateway's trusted passkey path; no voice approval tool exists.

Lifecycle events authenticate `x-webhook-secret` and dedupe by
`webhook_request_id`. Event metadata/state commit together; an unknown provider
call returns 503 for retry until the dial response binds it. Tool requests use a
separate bearer secret. Each has a hidden internal `voice_session_id` mapped to
gateway `call_id`, plus a hidden server-issued nonce as `webhook_request_id`.
[Webhook assignments](https://docs.cartesia.ai/agents/webhook-tools) advance
`delivery_nonce` from the relay's `next_delivery_nonce` on success. This avoids
inventing an undocumented provider request-ID field or letting the model pick IDs.
Use one tool at a time. Changed/reused nonces fail; duplicate retries return
`can_confirm:false` with no replay of financial context or an old ALLOW.

## Local setup and live retest

From repo root, `pnpm install`. Keep secrets/target/consent only in `.env.local`;
names are in root `.env.example`. Reuse T1's already provisioned free number via
private `.env.t1/resources.json`. Generate distinct `VOICE_TOOL_SECRET`,
`VOICE_ADMIN_SECRET`, `TOOL_GATEWAY_SECRET`, and `CARTESIA_WEBHOOK_SECRET`. If the
last is already used by T1, preserve it. Configure `VOICE_PUBLIC_URL` to a tunnel
for localhost:8788 (or `VOICE_PORT`):

```sh
cloudflared tunnel --url http://127.0.0.1:8788 --no-autoupdate
node orchestrator/src/voice/run.mjs setup
node orchestrator/src/voice/run.mjs serve
```

`setup` saves each resource ID immediately, reuses those IDs, updates tunnel URLs,
and attaches the lifecycle webhook. `serve` runs the actual existing gateway with
a local file adapter. State is private in `.env.voice/`: atomic file replacement
and serialization support **one writer process only**. Stream C's transactional
database adapter is still required for a shared/hosted runtime. Approval UI,
outbox delivery, and bank reconciliation remain owned by their existing streams.
The local demo uses synthetic invoice 1042 ($4,800 principal + $150 fee); this is
not a bank payment or a real customer debt. Do not run both servers against one
state directory or point this local file adapter at multi-instance hosting.

After Aziz is back **and firstmate gives fresh go**, choose one retest command:

```sh
# Full M4 flow with the nine real tools; destination is .env.local:T1_DIAL_TO.
VOICE_DIAL_GO=yes node orchestrator/src/voice/run.mjs dial

# Original T1 echo-only flow, using its original localhost:8787 server/tunnel.
T1_DIAL_GO=yes node --env-file=.env.local orchestrator/src/voice/t1.mjs dial
```

Under `demo:up` with `DEMO_VOICE=1`, the office desk phone's **Request call** button
is the in-app path: see [`web/lib/calls/README.md`](../../../web/lib/calls/README.md).
That click is the operator's go for one dial; every other path keeps `VOICE_DIAL_GO`.

Let the disclosure finish; answer the Jordan identity question naturally. The M4
local controller endpoint authenticates a separate admin secret, uses only the
server's configured synthetic scenario/target, and persists consent before dial.
`admin-dial.ts` gates it: one dial in flight and one call on the line (held until
the journal stops it, 10 minutes at most; an unconfirmed provider request holds
90 s and is never redialed). It then reads the host's `/__demo/status` pre-call
through the bridge and dials only on `ready`, passing that result's `signals` into
`DialInput.signals` so `evaluate` re-checks stops and narrows the envelope. A
`blocked` result returns `409 PRECALL_BLOCKED:<reason>`; `not_prepared`, `paused`,
malformed or unreachable status also refuses. Each refusal appends
`CALL_BLOCKED_PRECALL` to `.env.voice/audit.jsonl` with no provider request. Mock
`demo:up` (no `DEMO_LIVE=1`) never prepares a pre-call, so it never dials. After
each committed `call_started`/`call_completed`/`call_failed` the relay posts the
lifecycle (session id and event only) to the host's loopback `/__demo/voice-call-event`.
Use `DEMO_OVERRIDE=true` for the weekend demo; the server prints the visible
indicator and stores the permit rule. A prior persisted client stop refuses new
calls. Do not clear a real opt-out just to rerun a test.

T1 evidence and the phone-free WebSocket smoke command are in
[`docs/t1-cartesia.md`](../../../docs/t1-cartesia.md). The second coordinated phone retest completed disclosure, identity, context, fee-waiver denial, two-payment approval and a queued link. Four-payment escalation and link delivery remain unproven; tool-only lifecycle turns were fixed after the call. See the evidence and limitations there. A new call still requires fresh firstmate go.
`serve` records private redacted request/result timing in `.env.voice/http-evidence.jsonl`;
evidence failures never interrupt webhook responses. Do not add HTTP monkeypatch
preloads to the live receiver.

## Checks

```sh
pnpm --filter @backroom/orchestrator exec vitest run src/voice
pnpm --filter @backroom/orchestrator typecheck
```

Tests mock Cartesia HTTP and use the real policy/gateway for identity, plan/link,
stop, duplicate, malformed/auth, and restart cases. Sources are linked in code:
[outbound calls](https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing),
[dynamic variables](https://docs.cartesia.ai/agents/dynamic-variables), and
[call event envelopes](https://docs.cartesia.ai/line/infrastructure/observability#webhooks).
