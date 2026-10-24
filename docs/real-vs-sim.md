# Real vs. simulated disclosure (#25)

`web/components/RealVsSim.tsx` is mounted by the root layout, above the canvas on
all routes. `/real-vs-sim` shows the detailed version instead of duplicating the
compact panel. Document routes reserve measured scroll clearance so the fixed
panel does not cover their final form controls. The ten disclosure entries and their types live in
`web/lib/real-vs-sim.ts`.

The public, read-only `GET /api/demo-status` returns only `measuredAt`,
`llmEnabled`, and an allowlisted GX10 health snapshot. It reads the same runtime
exports as the default router and `/api/llm`; it never creates a router, starts
health polling, calls a model, or exposes a credential. Existing authenticated
LLM control is unchanged.

`getRouterHealth()` returns null until the default `route()` has initialized its
router. Health now includes `checkedAt` (null until a completed health ping), so
the optimistic initial availability cannot become an online claim. Status
refreshes every 10 seconds, times out after 6 seconds, and treats snapshots or
observations older than 30 seconds as unverified. OFF takes precedence over
health for model-dependent entries. Sandbox classification is always visible.

Phone, Claude, Apify, policy execution and SpacetimeDB connection availability
remain **unverified** here: no adapter health evidence is wired for them yet.
“Real” identifies the integration category, not a successful live run. A separate
orchestrator process needs shared durable state for LLM control and a transport
for its router health; this endpoint reports only the Next server process.

## Verification

- `pnpm -r test` includes network-free disclosure, status endpoint and router tests.
- `pnpm -r build` and `pnpm --filter @backroom/web typecheck`.
- Start production web on port 3125 after building, then run:

```sh
CHROME_BIN='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
  pnpm --filter @backroom/web exec node scripts/real-vs-sim-smoke.mjs
```

`DEMO_URL` overrides the default `http://127.0.0.1:3125`. The script launches an
isolated headless browser, verifies desktop/mobile layout and error states, and
writes screenshots to `docs/evidence/25/`. `off-*.png` uses a mocked OFF response;
no service availability or live call is proved by these screenshots.
