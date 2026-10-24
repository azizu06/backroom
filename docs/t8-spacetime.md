# T8 SpacetimeDB go/no-go: PASS (local)

Verified 2026-10-24 at approximately 00:41 PDT, before the Sat 02:00 hard stop.
The TypeScript module publishes locally, the database rejects an out-of-badge
write, the real policy package bundles and runs in the reducer, and the Next.js
page subscribes to row changes in less than 1 second. **Maincloud publication and authenticated seeding are verified; hosted office parity is recorded below.**

## Environment and commands

- macOS arm64; Node v24.22.1; pnpm 12.14.0; TypeScript 5.9.3.
- SpacetimeDB CLI/standalone 2.13.0, commit `08e1aba133671f9c631c6e70133a82faa0e7b283`;
  `spacetimedb` npm SDK 2.13.0; Next.js 16.4.3 / React 19.3.1.
- Official installer fetched from <https://install.spacetimedb.com>, installed
  inside ignored `.t8-tools/spacetime` with `--root-dir` (no shared CLI replaced).
- Local server: `spacetime start --listen-addr 127.0.0.1:3108 --data-dir .t8-tools/db --in-memory --non-interactive`.
- Publish: `spacetime publish backroom-t8-validation --server http://127.0.0.1:3108 --module-path spacetime --yes`.
- Bindings: `spacetime generate --lang typescript --module-path spacetime --out-dir web/lib/spacetime --yes`.
- Web: `pnpm --filter @backroom/web dev --port 3208`; Chrome at `http://localhost:3208/t8`.
- Live checks: `T8_LIVE=1 node spacetime/scripts/live-t8.mjs` (isolated CLI overrides
  documented in [`../spacetime/README.md`](../spacetime/README.md)).

Every `spacetime` command above used the isolated binary with
`--root-dir=.t8-tools/spacetime` before the subcommand.

## Rejection and policy bundling: PASS

The module imports `evaluate` from the workspace package `@backroom/policy`;
that package imports its JSON policy and TypeScript helpers normally. No copied
policy, mock evaluator, or alternate implementation is used in the module.
Both `publish` and `generate` reported `Build finished successfully`.

The authorized publisher invoked `request_room_entry("collections-1", "payables")`.
The row's stored badge is `collections`; reducer output was:

```text
Error: Response text: DENY:NOT_IN_BADGE
HTTP status server error (530)
```

The live script queried the complete `agent` row before and after, verifying byte-identical
CLI SQL output. The same publisher could enter `collections`. An unauthenticated
HTTP call to `set_agent_target` returned `CONTROLLER_REQUIRED`; its before/after row
was also identical. The private controller identity is set at publish time;
reducer arguments cannot supply a badge or controller identity.

Vitest also invokes the actual reducers and evaluator against the SDK's local WASM
datastore: forbidden room throws, rollback preserves the row, and allowed room succeeds.
No network calls occur in that test.

## Row write → Next.js DOM: PASS

The live script wrote 20 unique targets, spaced 125 ms apart. `set_agent_target`
stamps `heartbeatAt` with the reducer's server timestamp. `/t8` subscribes via the
generated TS `DbConnection`, refreshes React state in `agent.onUpdate`, and records
`Date.now() - heartbeatAt` in `useLayoutEffect` **after the row is committed to the DOM**.
Chrome inspection confirmed status `subscribed`, all 20 unique samples, and the final
DOM target `t8-sample-1792827768875-20`.

Run `1792827768875`, in write order, milliseconds:

```text
2, 4, 5, 3, 4, 4, 4, 4, 4, 4, 4, 3, 5, 4, 2, 4, 5, 3, 3, 4
```

n=20; min=2 ms; median=4 ms; p95=5 ms; max=5 ms; **20/20 ≤1000 ms**.
Server and browser share the same Mac clock; integer millisecond quantization applies.
This measures DOM commit, not physical screen presentation. Localhost results do
not claim Maincloud/network latency. Initial or reconnect snapshots do not count as
fresh writes; use the live script's fresh run ID when evaluating samples.

The page only subscribes. Reducers perform permission checks with the renderer closed
or open; no UI event triggers authority or changes room permissions. This original T8 run did not measure full §4.9 audit parity; the later full-module
Maincloud evidence below supersedes that limitation.

## Maincloud: VERIFIED

On 2026-10-24, Aziz completed `spacetime login --no-browser` using CLI 2.13.0.
`login show` confirmed the authenticated identity without printing a token.
The earlier `401 InvalidSignature` was a local-only identity, not a module build
failure. The full current-main schema/reducers published successfully:

```sh
.t8-tools/spacetime/spacetime --root-dir=.t8-tools/spacetime publish \
  backrooms-calhacks13 --server maincloud --module-path spacetime --yes
```

- Hosted dashboard: <https://spacetimedb.com/backrooms-calhacks13>.
- Database identity: `c200be1be7f36d55de859088afc916ea52c55bf4407be592e0248abec1cd73c3`.
- Anonymous office URI: `wss://maincloud.spacetimedb.com`.
- Authenticated `SpacetimeTransport.seedCompany` imported synthetic Northfield:
  10 clients, 25 vendors, 10 AR invoices, 83 AP invoices. No live provider action.
- Publisher credentials remain private server configuration; never expose them
  through browser props, public env vars, evidence, board posts or command output.

`DEMO_SPACETIME=maincloud pnpm demo:parity` passed on 2026-10-24 at
13:48:26 UTC (06:48 PDT), against two fresh hosted databases. See the committed
[proof and screenshots](evidence/maincloud-parity/README.md).

- Browser closed/open runs: 10 byte-identical normalized audit rows, both chains
  valid; IDs preserved; only `ts`, `hash` and `prevHash` excluded.
- Closed-world office catch-up, authenticated reducer DENY preserving the agent,
  visible red door (`audit:11`), and OFF propagation all passed.
- Anonymous renderer: zero state writes and zero browser errors.
- 20/20 request-to-frame samples below 1000 ms: min 86.2 ms, median (upper middle)
  104.3 ms, nearest-rank p95 168.3 ms, max 207.7 ms. These include network time.
  The browser uses `performance.now()` before reducer dispatch until DOM target
  commit plus two animation frames. This includes Playwright/controller overhead;
  it does not subtract a remote server clock or measure physical display latency.
- The parity run made no bank, voice or model requests. Hosted publication does
  not establish persistence for the separately in-memory gateway/finance stores.

Reproduction (authenticated CLI 2.13.0, production web build):

```sh
pnpm --filter @backroom/web build
DEMO_SPACETIME=maincloud pnpm demo:parity
# Default local lane remains unchanged:
pnpm demo:parity
```

`SPACETIME_CLI` / `SPACETIME_ROOT` select the CLI install; `SPACETIME_CONFIG`
optionally selects a different authenticated CLI config for hosted parity. Do not
pass the manager's own root config again: CLI 2.13.0 can stall publishing when
that same config is explicitly supplied twice. Each parity run publishes two
fresh owned databases and retains them for evidence; no shared DB is reset.

Local standalone remains the default fallback; a Maincloud outage must not
silently substitute simulated state.

## Scope and continuation

The original T8 spike established the module/policy/subscription path. The full
§4.7 schema and `StateStore` adapter have since landed; see
[`spacetime/README.md`](../spacetime/README.md) for their reducer, lease, fencing,
audit and server-verified approval contracts. The Maincloud verification above
uses that full module and its existing generated bindings without schema changes.

Keep network I/O in the orchestrator; reducers perform deterministic state writes
and policy evaluation. Hosted office parity does not establish live voice,
real human passkey hardware, bank reconciliation or GX10 web hosting.

Primary references: [official TypeScript quickstart](https://spacetimedb.com/docs/quickstarts/typescript/),
[official installation/local server guide](https://spacetimedb.com/docs/).

Validation: `pnpm -r build` passed, including static generation of `/t8`;
`pnpm -r test` passed 143 tests after rebasing on the merged orchestrator/gateway
(94 policy, 48 orchestrator, 1 module reducer).

## Rebase validation (01:18 PDT)

Rebased onto main through `ded1f59` (including the new audit and Cartesia voice
work). Kept both sets of shared env names and ignore rules, LLM-control/passkey
documentation pointers, all existing lockfile dependencies, and the newly added
#15 audit adapter contract in `spacetime/README.md` alongside the T8 dev loop.
The module README now follows the repository's Node 22+ requirement.

- `pnpm install --frozen-lockfile`, `pnpm -r typecheck`, `pnpm -r test`,
  `pnpm -r build`: PASS; 355 workspace tests (94 policy, 218 orchestrator,
  42 web, 1 SpacetimeDB).
- Red-team replay Vitest suite: 28 PASS; its standalone TypeScript check: PASS.
- `pnpm --filter @backroom/web test:approvals:browser`: 1 PASS, including real
  local passkey verification for Deny / Approve / Counter.
- `git diff --check`: PASS. Original local T8 latency/rejection evidence above
  remains the spike evidence; Maincloud remains deferred.
