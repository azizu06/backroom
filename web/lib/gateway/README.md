# Cartesia tool gateway (#19)

Nine POST endpoints live at `/api/tools/<tool>`. The dynamic route allowlists
only the names in `parser.ts`. Set `TOOL_GATEWAY_SECRET` (already named in root
`.env.example`) on the server and in Cartesia's bearer authentication. Never
include the secret in client code. Responses carry `can_confirm: false` unless
`propose_plan` committed a matching ALLOW audit and plan in the same transaction.
Only confirm the exact plan returned by that successful response.

## Cartesia configuration

Current source: https://docs.cartesia.ai/agents/webhook-tools.md (checked Oct 24,
2026). Cartesia's `api_schema.request_body_schema` defines the actual POST JSON;
there is no fixed `arguments` wrapper. Configure `api_schema.method: "POST"`,
HTTPS URL, and `authentication: { mode: "bearer", token: { type: "secret",
secret_value: <your secret> } }`. Keep pre-tool speech neutral: no commitment
before the result. Unit tests do not prove spoken compliance: scan actual
`call_turn` events against the returned audit IDs during the live call eval.

Every body requires `call_id` and `webhook_request_id`, nonempty identifiers
(max 200 characters; letters, digits, `_ . : -`). Set `call_id` from a trusted
per-call dynamic variable bound by the orchestrator, never from conversational
input. Supply a unique `webhook_request_id` for each logical invocation and keep
it unchanged on delivery retries. The current tool docs do **not** promise an
automatic request-ID field; validate the actual live payload before provisioning.
If the provider does not offer a retry-stable ID, a trusted relay must mint and
preserve one. Do not reuse a constant call ID as a request ID. The only wire-shape
boundary is `parseInvocation` in `parser.ts`.

Additional required fields (unknown fields are rejected):

| Tool | Fields |
| --- | --- |
| `get_invoice_context` | none |
| `verify_identity_result` | `result`: `confirmed`, `wrong_person`, `uncertain` |
| `propose_plan` | `installments`: integer 1–100; `first_payment_pct`: 0–100; `duration_days`: integer 0–3650; `waive_fee`: boolean; `discount_pct`: 0–100 |
| `check_approval` | `escalation_id` |
| `send_payment_link` | `plan_id` (never an amount or recipient) |
| `mark_dispute`, `record_opt_out`, `request_human`, `report_already_paid` | none |

Ranges above validate transport; policy determines authority. Repeated identical
request IDs return `duplicate: true`, `can_confirm: false` and perform no write.
Reusing an ID with changed arguments, a different tool, or a different call is a
409. No cached financial context is replayed after identity or call state changes.

## State and integration

`store.ts` exports `GatewayStore` and gateway domain types. At trusted server
bootstrap, call `installGatewayStore(adapter)` from `runtime.ts`. The adapter must supply `receivable: { principalCents, lateFeeCents }` alongside
the total `amountCents`, and may supply trusted `policyState: { policy, signals }`.
It must resolve Cartesia call IDs to server-owned invoice/client records; never trust an
invoice ID, amount, policy version, approval, or payment recipient from voice.

The included `MemoryGatewayStore(calls)` clones and serializes transactions,
committing state, audit, plans, links, outbox and dedupe together. It starts empty,
returns 404 for unknown calls, and loses data on restart. It is for local use, not
multi-instance Vercel persistence. A durable adapter must enforce global delivery
ID uniqueness, serialize by call, and roll back failed transactions. This is a
small gateway-specific seam, not an assumed replacement for #16's StateStore.

The orchestrator consumes `outbox`: deliver `send_payment_link` using the
server-owned client's verified contact, propagate `record_opt_out` to durable
client DNC, route dispute/human requests, and enqueue already-paid reconciliation.
A queued payment link is not a sent email or a bank deposit. `report_already_paid`
pauses collection; it never marks the invoice paid. `/pay/<id>` must look up the
stored link amount, never accept a URL/body amount. No pay page or delivery
provider is implemented in this stream.

`check_approval` reads only this call's escalation. A result lacking trusted
`method: "passkey"` stays pending. Even a verified approval is not an ALLOW or
permission to confirm: resubmit exact terms through policy. There is no voice
approval endpoint. The approval backend must validate the passkey before writing.

`policy-adapter.ts` is the only consumer of the policy package's exported API.
It maps gateway terms into the real nested policy `Plan` and passes identity,
saved policy/version, risk signals, and principal/fee amounts from trusted state.
The production evaluator runs both for proposals and again before a link is
queued, so a fresh bankruptcy/OFAC/dispute signal or changed policy blocks links.
Cents rounding and fee retention match the policy package. Complete decisions
(including exact policy quotes) are retained on decision audit entries.
Negotiation tests exercise the real package: no policy decisions are mocked.
No model or GX10 request is needed for this deterministic gateway.

## Verification

From repo root (reuse the existing policy workspace's Vitest, no web package edit):

```sh
pnpm --filter @backroom/policy exec vitest run --root ../web --globals lib/gateway/gateway.test.mjs
pnpm --filter @backroom/web typecheck
pnpm --filter @backroom/web build
```

Tests exercise the public HTTP handler, with no network. Opt-in HTTP smoke against
a running server: set `TOOL_GATEWAY_URL`, `TOOL_GATEWAY_SECRET`, then run
`node web/lib/gateway/smoke.mjs`. Optionally set `TOOL_GATEWAY_SMOKE_CALL_ID` to an
existing fixture call to exercise context; otherwise expect unknown-call 404.
It does not place a Cartesia call. Live voice and durable-store wiring remain
integration checks for their owning streams.

## M6 controller bridge

The default runtime now installs a StateStore-backed approval bridge. Escalations
return `approval_path`; `check_approval` reads server-verified decisions and returns
`pending_owner` after 60 seconds. Optional trusted `GatewayCall.agentId` connects
the desk target to the live office agent. Full configuration, wire shapes,
passkey enrollment, and single-process persistence limits: `docs/m6-approvals.md`.
