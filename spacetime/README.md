# spacetime/

Placeholder. The SpacetimeDB TypeScript module (tables and reducers, spec §4.7) lives here.
Owner: Anthony (`@MarioTeachesTyping`), stream C. See issues #8 and #15. Not part of the pnpm workspace until the module exists.

## #15 audit adapter contract (Refs #23)

The canonical reference, read API, hash format and replay rules live in
[`orchestrator/src/audit/README.md`](../orchestrator/src/audit/README.md).
Implement the exported orchestrator `StateStore`; use one shared chain for all
seats, the tool gateway, model-route evidence, recovery, approvals and LLM OFF.

`audit_entry` table: `seq` (unique monotonic integer, primary key), `id` (unique
string), `ts` (integer Unix milliseconds), `actor` (`code | local_model | claude |
human | client | system`), `seat`, `action`, `inputs` (canonical JSON), `ruleIds`
(string array), `policyVersion` (integer), `refs` (evidence string array), `route`,
`latencyMs`, `costUsd` (finite nonnegative numbers), optional `decision`
(`ALLOW | DENY | ESCALATE`), `prevHash`, `hash` (lowercase SHA-256 hex).
The selected model ID remains in `inputs.model` when present. Preserve numeric
values exactly; bigint database seq/ts values must be safely converted to JS
integers for canonical serialization, never hashed as quoted decimal strings.

`append_audit` is an authenticated trusted-server reducer, never a browser/model
writer. Accept `AuditInput` (optional stable ID; otherwise `audit:<seq>`), validate
metadata/JSON and ID uniqueness, atomically assign the next seq and previous hash,
compute the canonical SHA-256 hash, and insert. For a batch, validate/append all or
none. Never trust a caller's seq, prevHash or hash. Expose **no update/delete
reducer** for `audit_entry`; state-changing reducers must append their evidence in
the same transaction. Gateway call/dedupe/outbox and its audit must commit together.
An LLM-OFF change and its audit also commit together; see `docs/llm-control.md`.

Support `listAudit(sinceSeq=0)` with exclusive `seq > sinceSeq` in ascending order,
`getAudit(id)` and full `verifyAuditChain()` status. Do not verify a page as if it
were a complete chain from genesis. Subscription rows can feed the wall, while
ask-why uses an authorized verified snapshot and its existing allowlist projection.
