# Judge attack demo

Private server: `pnpm --filter @backroom/orchestrator attack-demo:serve`.
It binds `127.0.0.1:8790` (`ATTACK_DEMO_PORT` overrides the port).
Configure `TOOL_GATEWAY_SECRET` in the server process, as for the handoff server.
The server and smoke launcher load repo-root `.env.local` if present; existing
process environment takes precedence. Never put this secret in browser props or a
`NEXT_PUBLIC_*` variable. Diego's UI should proxy through its trusted controller.

## Controller HTTP contract

Both methods require `Authorization: Bearer <TOOL_GATEWAY_SECRET>`. All responses
are `Cache-Control: no-store`; there is no browser CORS allowlist.

- `GET /api/attack-demo` → `{presets:[{id,title,senderDomain,text}],defaultMode:'mock'}`.
- `POST /api/attack-demo` accepts `{text?:string,presetId?:string,mode?:'mock'|'live'}`.
  Supply text or presetId. Text wins if both are present. Text is 1–16,000 characters;
  unknown fields are rejected. The body is bounded to 64 KiB before JSON parsing.

Preset ids: `prompt-injection`, `lookalike-vendor`, `split-invoice`,
`urgency-pressure`. Preset sender domains are simulated envelope metadata.
Edited/pasted text always has sender `unknown.invalid`; a line in the document
cannot authenticate a sender. Every input is `source:'judge'` and
`trust:'untrusted_data'`, including canned presets.

Example response (fields abbreviated):

```json
{
  "mode": "mock",
  "source": "judge",
  "trust": "untrusted_data",
  "environment": "isolated_synthetic_company",
  "caseId": "attack-...",
  "senderDomain": "acme-supp1y.com",
  "steps": [
    {"role":"intake","execution":"code","observed":"document text","proposed":"Treat as untrusted data"},
    {"role":"extractor","execution":"mock","observed":"invoice line","proposed":"validated fields JSON"},
    {"role":"vendor","execution":"code","observed":"master comparison JSON","proposed":"Hold changed destination"},
    {"role":"payables","execution":"code","observed":"amount and PO evidence JSON","proposed":"Assess only","decision":{"kind":"ESCALATE","ruleIds":["LOOKALIKE_DOMAIN","BANK_CHANGE_HOLD"]}},
    {"role":"auditor","execution":"code","observed":"decisions JSON","proposed":"Record evidence"}
  ],
  "skippedRoles": ["collections", "reconciler"],
  "decision": {"kind":"ESCALATE","ruleIds":["LOOKALIKE_DOMAIN","BANK_CHANGE_HOLD"],"reason":"Policy explanation","policyVersion":1},
  "rules": [{"id":"LOOKALIKE_DOMAIN","reason":"Exact policy sentence"}],
  "moneyMoved": false,
  "paymentAttempts": 0
}
```

`Decision` objects also contain the authoritative `quote` and, for escalation,
`toHuman` fields. Each step carries its own policy result; the final result uses
the first blocking decision and collects the rules across the submission.
Render `observed`, `proposed`, model proposals and document text as escaped text,
never HTML/Markdown with raw HTML. Label mock/code/live execution visibly.
Do not animate skipped roles as if they executed. This is a completed trace
returned after processing, not a stream of live tool events.

Errors are `{error:string}`: 400 invalid JSON/input, 401 unauthorized, 403 live
not enabled, 404 unknown route, 405 wrong method, 409 LLM OFF/cancelled, 413 oversized
body, 429 live attempt already used, 502 live runtime failure, 503 missing gateway
configuration/unavailable service. A live failure returns an error, never fabricated
live evidence; the controller can submit a separate mock request explicitly.

## What the trace proves

`orchestrator/src/attack-demo/index.ts` exports `runAttackDemo(input)` as a runtime
or controller seam. It calls the existing `processInbox` path with an explicit
deterministic extraction adapter, then `PayablesSeat.assess` and the real policy
engine. State and vendor records are fresh synthetic per-request objects. There
is no payment adapter, master-data writer, passkey approval or outbound call/email
capability. No voice/legal calling path is invoked.

The mock extractor recognizes the complete structured invoice transcription format
used by the existing `structuredInvoice` fallback. Arbitrary prose with missing
facts returns `INVALID_INPUT`; the parser does not invent amounts, vendor ids or
account references. The presets are editable starting points for a judge.

| Preset | Expected rules |
| --- | --- |
| Prompt injection + new bank | `BANK_CHANGE_HOLD` |
| Lookalike bank-change email | `LOOKALIKE_DOMAIN`, `BANK_CHANGE_HOLD` |
| Two $1,500 invoices in one submission | `OVER_LIMIT` on aggregate, `NO_PO` on individual invoices |
| Urgent $9,999 with claimed verbal approval | `OVER_LIMIT` |

Split protection groups invoices by vendor **within this submitted document** and
assesses the combined amount before execution. It does not implement or claim
cross-email/time-window split detection. CRS is not called in this offline demo;
fraud evidence is the real domain/master comparison and policy rules. The seven-role
roster is shared with the agent runtime via `agents/contracts.ts`; mock specialist
steps are code/parser traces, not fabricated SDK activations.

## Opt-in live Haiku evidence

Mock is the default and needs no network or credentials:

```sh
pnpm --filter @backroom/orchestrator attack-demo:smoke
```

For one live activation, on the Mac with Keychain service `backroom-anthropic-key`:

```sh
ATTACK_DEMO_LIVE=1 pnpm --filter @backroom/orchestrator attack-demo:smoke -- --live
```

This uses the merged `ClaudeAgentRuntime` with Haiku, three turns maximum, a 25 s
activation timeout and a $0.02 activation cap. The sole custom tool records a
short untrusted narrative proposal. It cannot pay or alter policy, and its answer
never changes deterministic extraction or policy decisions. There is no Sonnet,
Opus, GX10 or cloud fallback. One attempt per analyst/server instance is reserved
before SDK work, including failures. SDK cost and model usage are charged to owner
`aziz` through the shared `FileUsageLedger` at `.env.agents/usage-ledger.json`, the
same ledger used by `demo:agents`; missing accounting charges the full reservation.
Run both services from the same working directory to share that file. The host's
LLM OFF signal aborts and fences late output, including OFF/ON cycles. As described
in `docs/llm-control.md`, a standalone server's default in-memory StateStore is
process-local. To share the controller's OFF switch across processes, install its
durable StateStore adapter at host bootstrap; independent memory stores do not
implement a shared switch.

The smoke writes `docs/evidence/attack-demo/live-haiku.json` containing only the
synthetic preset trace, SDK receipt and usage totals. The HTTP live response adds
`modelEvidence:{provider,model,proposal,usage,ownerUsage}`. No key is returned or
logged. Tests drive the actual SDK adapter with the network-free scripted query;
those tests are not evidence of a paid live model call.

Verify with `pnpm --filter @backroom/orchestrator exec vitest run src/attack-demo`
and `pnpm --filter @backroom/orchestrator build`.
