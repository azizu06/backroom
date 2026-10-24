# Ask why (server only)

`askWhy(question, entries, options?)` retrieves up to 12 relevant records, asks
Claude through OpenRouter, and returns `{ answer, citations, source }`. The default
model is `anthropic/claude-haiku-4.5`; pass `options.model` for demo routing.
`OPENROUTER_API_KEY` and `OPENROUTER_BASE_URL` are existing server-side env vars.
No key or no relevant evidence means no network request. A provider failure or two
invalid outputs produces a code-templated response. `source: "ungrounded"` has no
citations and explicitly declines to ground the answer.

`WhyAuditEntry` is a read-only DTO, not a new state table or hash-chain contract.
The state adapter maps verified audit rows into this allowlist: id, actor, seat,
action, outcome, policyVersion, ruleIds, evidenceRefs, and the typed `inputs`.
Unknown fields (including raw emails/invoices) are stripped. Only uniquely named,
valid records are eligible. Numeric invoice/entry/reference matches take priority;
without ids, keyword matching selects evidence. No embeddings or GX10 dependency
is needed in this demo path. Citation validity proves record identity, not semantic
entailment; the model's explanation still needs the demo's human review.

The strict model response is JSON:

```json
{"answer":"Invoice was held as a duplicate [entry:212].","citations":["212"]}
```

Every cited id must belong to the retrieved evidence and appear inline as
`[entry:ID]`. Invalid output gets one correction attempt. There are no model tools,
state writers, payment calls, or approvals in this module.

For a future web route, bind an authenticated, authorized server-side loader:

```ts
const POST = createAskWhyHandler(async request => {
  // Authenticate request and return the caller's verified audit records.
  return loadAuditForCaller(request);
});
```

The handler accepts `POST { "question": "..." }`, ignores caller-supplied audit
records, returns `WhyAnswer` JSON, and rejects malformed requests with 400 or 405.
Authorization and audit-chain integrity belong to the loader. Voice and UI are
outside this service.

Tests: `pnpm --filter @backroom/orchestrator test`. Fixtures and the independently
written three-question answer key live in `fixtures/why/` (synthetic projections,
not signed or chain-verified state rows).

Opt-in smoke, from repository root after `openrouter-env` populates the ignored
`.env.local` (three questions, up to six cheap Claude requests; prints only fixture answers):

```sh
WHY_LIVE=1 pnpm --filter @backroom/orchestrator exec node --env-file="$PWD/.env.local" --import tsx src/why/smoke.ts
```
