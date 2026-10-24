# SpacetimeDB module

T8 is implemented in `src/index.ts`. Local evidence: [`../docs/t8-spacetime.md`](../docs/t8-spacetime.md).
This is the small go/no-go module, not the full §4.7 schema or the orchestrator StateStore adapter (follow-up #15).

## Dev loop

Requires Node 22+, pnpm, and SpacetimeDB **2.13.0** (CLI and SDK pinned together).
Official installation: <https://spacetimedb.com/docs/>.

```sh
# From repo root, once:
curl -sSf https://install.spacetimedb.com | sh
pnpm install

# Terminal 1. Port 3108 avoids Next.js's default port.
spacetime start --listen-addr 127.0.0.1:3108 --data-dir .t8-tools/db

# Terminal 2. Publish first; init records the publishing identity as controller.
spacetime publish backroom-t8-validation --server http://127.0.0.1:3108 --module-path spacetime --yes
spacetime generate --lang typescript --module-path spacetime --out-dir web/lib/spacetime --yes
pnpm --filter @backroom/web dev --port 3208
# Open http://localhost:3208/t8

# The same CLI identity that published can write. The browser only subscribes.
spacetime call --server http://127.0.0.1:3108 backroom-t8-validation set_agent_target collections-1 collections-door
spacetime call --server http://127.0.0.1:3108 backroom-t8-validation request_room_entry collections-1 payables
# Expected failure: DENY:NOT_IN_BADGE; the transaction leaves the row unchanged.
```

For an isolated CLI install (used in T8), install with
`sh install.sh --root-dir "$PWD/.t8-tools/spacetime" --yes`, then replace each
`spacetime` command with `.t8-tools/spacetime/spacetime --root-dir=.t8-tools/spacetime`.
Download `install.sh` from the official installer URL above. `.t8-tools/` is ignored.
Use `--in-memory` on `start` only for disposable tests; those rows disappear on exit.

After editing the module: publish again, regenerate bindings, run `pnpm -r build` and
`pnpm -r test`. Commit the generated `web/lib/spacetime/` files together with schema changes.
Do not log out between publishing and writing: the stored controller is the original
publisher identity. Back up CLI credentials privately; never put them in the repository.

## Exported contract

- Public `agent` table: `id` (string PK), `seatId`, `state`, `room`, `targetAnchor`,
  `posX`, `posY`, `heartbeatAt` (server Timestamp), optional `currentTaskId`, `modelRoute`.
  One seed row: `collections-1` / seat `collections` / room `collections`.
- `request_room_entry({ agentId, room })`: publishing identity only; calls the real
  `@backroom/policy.evaluate` with the **stored** seat badge. Non-ALLOW throws a
  `SenderError` carrying decision kind and rule IDs; no row is written.
- `set_agent_target({ agentId, targetAnchor })`: publishing identity only; updates
  target + server heartbeat. Anchor must be nonblank and at most 120 characters.
  This is visual targeting only, not permission to enter a room or approve anything.
- Private `controller` table: protects writes; no credential/token is public.
- Generated client: `web/lib/spacetime` exports `DbConnection`, `tables`, `reducers`;
  `web/lib/spacetime/types` exports `Agent`.
- `/t8`: anonymous, read-only subscription; records row-write → React DOM commit
  latency for fresh `t8-sample-*` targets. Initial/reconnect snapshots are excluded.

Optional public web config in `web/.env.local` (restart Next.js after changes):

```dotenv
NEXT_PUBLIC_SPACETIME_URI=ws://127.0.0.1:3108
NEXT_PUBLIC_SPACETIME_DATABASE=backroom-t8-validation
```

Never expose `SPACETIMEDB_TOKEN` as a `NEXT_PUBLIC_*` value. The browser needs no
writer token. The existing server-side `SPACETIMEDB_*` env vars remain reserved for
the future StateStore adapter.

## Verification

`pnpm --filter @backroom/spacetime test` runs Vitest against the SDK's local WASM
datastore, with no network or credentials. For an already-running disposable local
module and an open `/t8` page:

```sh
T8_LIVE=1 node spacetime/scripts/live-t8.mjs
# Isolated install:
T8_LIVE=1 SPACETIME_CLI="$PWD/.t8-tools/spacetime/spacetime" \
  SPACETIME_ROOT="$PWD/.t8-tools/spacetime" node spacetime/scripts/live-t8.mjs
```

The opt-in script checks forbidden-room rollback, anonymous-writer rejection,
allowed-room success, then writes 20 unique targets. Read the page's latency samples;
filter by the printed run ID and require **20 samples**, each between 0 and 1000 ms.
Measurements assume server and browser are on the same host. A cross-host test needs
clock synchronization or a separate same-clock end-to-end measurement.

## Maincloud

Local PASS does not establish Maincloud auth or deployment. T8's Maincloud attempt
returned 401 `InvalidSignature` using the local-only CLI identity. Anthony/Diego can
finish `spacetime login` in their browser, publish with `--server maincloud`, and
verify an HTTPS/WSS subscription. Keep the production writer identity distinct from
anonymous renderer clients. No Convex implementation is included.

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
