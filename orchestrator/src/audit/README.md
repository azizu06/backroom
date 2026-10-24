# Audit chain (Refs #23)

`StateStore.appendAudit(input)` keeps its existing signature. Every seat,
collections/model-route, recovery, approval and LLM-switch audit now uses
`AuditLog` in `index.ts`. `appendAudits(inputs)` appends a batch atomically;
invalid JSON, metadata or duplicate IDs reject the entire batch.

The development `MemoryGatewayStore` projects newly committed call audit records
into this same StateStore, retaining their UUID IDs. It defaults to the installed
`getStateStore()` and accepts an explicit audit store as its second constructor
argument for tests. Gateway retry/dedupe and transaction checks run before the
audit batch; an audit failure prevents call/plan/outbox/dedupe commit. The gateway's
`call.audits` is a compatibility projection, not the authoritative hash chain.
No new model or external service is used here.

## Read API

Import from `@backroom/orchestrator` on the server:

```ts
const status = await store.verifyAuditChain();
// Full-chain status, including valid, length, headHash, firstBrokenSeq;
// invalid chains also include reason. Show failures on the audit wall.
const page = await store.listAudit(lastSeenSeq); // exclusive seq cursor; default 0
const entry = await store.getAudit(id); // undefined when absent
```

These methods return detached snapshots and expose no update/delete operation.
The UI binds its authorized server loader to these methods; do not send controller
secrets to the browser. For ask-why, verify the complete snapshot with exported
`verifyChain(entries)` before projecting it to `WhyAuditEntry` (map `refs` to
`evidenceRefs`, the recorded decision to an outcome, and allowlisted `inputs`).
Use the same verified snapshot for projection rather than separately reading status
then assuming an arbitrary browser-supplied page is verified. `audit:<seq>` and
gateway UUID citations are accepted by #35. Unknown outcomes must be omitted,
never inferred from a model. Raw email/invoice text stays outside the projection.

## Wire format and replay

Each entry has `id`, `seq`, `ts` (integer Unix milliseconds), `actor`, `seat`,
`action`, `inputs` (defaults to `{}`), `ruleIds`, `policyVersion`, `refs`, `route`,
`latencyMs`, `costUsd`, `prevHash`, `hash`, and optional policy `decision`.
Existing model writers retain the selected model ID in `inputs.model` and copy
the router's route/latency/cost. Generated IDs are `audit:<seq>`; a trusted producer
can supply a unique, stable ID to keep existing citations. Seq is global within
one store and starts at 1; timestamps need not be strictly increasing.

Canonical JSON v1 is implemented by `canonicalAuditJson`: recursively sort object
keys lexically by UTF-16 code units, retain array order, use ECMAScript JSON
string escaping and finite number formatting, omit undefined object properties.
Reject cycles, sparse/undefined array elements, nonfinite numbers, bigint,
functions and nonplain objects. Hash UTF-8 canonical serialization of **all entry
fields except `hash`** with SHA-256, returning lowercase hex. Genesis `prevHash`
is 64 zeroes; every subsequent row points to the preceding row's hash. Database
adapters must use the same serialization and preserve millisecond timestamps and
finite JS numbers exactly; use canonical JSON strings for nested database fields.

`verifyChain(entries)` expects a full ordered chain from genesis and reports the
first failing expected sequence (including gaps/reordering), plus a reason.
`new AuditLog(savedEntries)` verifies before restoring; replay the saved inputs
with the same IDs and timestamps to reproduce identical entries/hashes. Restoring
the audit log alone does not restore other StateStore tables. An unanchored hash
chain detects edits and broken links, but cannot detect removal of a valid suffix
or wholesale replacement/recomputation; retain a trusted `(seq, hash)` checkpoint
outside the chain when that threat matters. Legacy insertion-order hashes are not
silently rehashed or migrated by this implementation.

The reference store remains process-local and loses state on restart. #15 must
commit state, gateway dedupe/outbox and canonical audit entries in one database
transaction; two independent remote writes do not provide that guarantee. The
existing cross-store approval bridge is not a durable transaction implementation.
The matching table/reducer contract is in `../../../spacetime/README.md`.

Tests: `pnpm --filter @backroom/orchestrator exec vitest run src/audit.test.ts`
and `pnpm --filter @backroom/web exec vitest run lib/gateway/gateway.test.mjs`.
The canonical genesis vector is independently checked with Python hashlib;
tampering, replay, cursors, isolation, atomic batches and gateway rollback/retry
are tested without network calls. There is no new live service to smoke-test.
