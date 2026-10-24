# T8 SpacetimeDB go/no-go: PASS (local)

Verified 2026-10-24 at approximately 00:41 PDT, before the Sat 02:00 hard stop.
The TypeScript module publishes locally, the database rejects an out-of-badge
write, the real policy package bundles and runs in the reducer, and the Next.js
page subscribes to row changes in less than 1 second. **Maincloud remains unverified.**

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
or open; no UI event triggers authority or changes room permissions. Full §4.9 audit
parity needs the forthcoming full schema and orchestrator adapter, and is not claimed here.

## Maincloud: OPEN (authentication)

Attempt:

```sh
spacetime publish backroom-t8-aziz-20261024 --server maincloud --module-path spacetime --yes=remote,skip-login
```

Build succeeded; remote pre-publish check failed:

```text
401 Unauthorized: Invalid token: InvalidSignature
```

The CLI had a local-server-only identity. `spacetime login --no-browser` requested a
browser login; the attempt was cancelled without completing it. No successful
Maincloud publish is claimed. Firstmate directed this task to skip Maincloud for now
and ship local evidence. **Anthony/Diego (whoever owns the browser login) must authenticate,
publish, and verify the hosted subscription before relying on Maincloud.**
Self-hosted SpacetimeDB is viable; this result does not trigger the Convex fallback.

## Scope and continuation

This ships T8 first. The full §4.7 table/reducer set plus durable orchestration semantics
is larger than a 45-minute safe extension: #15 must implement the exported #16
`StateStore` seam (`orchestrator/src/store.ts` in the orchestrator work), atomic
leases/fencing, idempotent effects/receipts, audit chaining, policy transitions and
controller/passkey approval checks. T8's private publisher controller is a spike
boundary, not a substitute for those product approvals.

The generated client and reducer signatures are documented in `spacetime/README.md`.
No Convex code or full-StateStore compatibility is claimed. Keep network I/O in the
orchestrator; the module performs deterministic state writes and policy evaluation.

Primary references: [official TypeScript quickstart](https://spacetimedb.com/docs/quickstarts/typescript/),
[official installation/local server guide](https://spacetimedb.com/docs/).

Validation: `pnpm -r build` passed, including static generation of `/t8`;
`pnpm -r test` passed 124 tests (94 policy, 29 ask-why, 1 module reducer).
