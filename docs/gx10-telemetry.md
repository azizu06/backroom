# GX10 live readout (Refs #24 #27)

`web/app/office/rooms/ServerRoom.tsx` mounts at one scene anchor. It owns its
readout and polling, with no Play/camera controls or business-state writes.
`web/lib/gx10/server-room.ts` formats fresh observations and hides stale values.

`GET /api/gx10` is public, aggregate evidence only. The server probes Ollama
`/api/ps` at the server-configured `GX10_BASE_URL` origin (default GX10 Tailscale
address). It never runs inference or SSH. Requests coalesce and cache for two
seconds; the probe times out after 1.5 seconds, rejects redirects, and caps the
body at 64 KiB. Model names are capped at 12 entries, 80 characters each.
No HTTP GPU exporter is configured, so utilization is explicitly unavailable.
The deployment must have network access to GX10; public hosting without
Tailscale/private routing will show Unreachable.

## Router evidence

The router's exported `getRouterTelemetry()` reads metadata from the existing
`route()` singleton without creating a router. `createRouter().telemetry()`
provides the same seam for explicitly constructed routers. No input, output,
customer identifiers, or credentials are retained. The bounded in-memory
window contains the last 200 model HTTP attempts, including failed requests,
schema retries, and fallback requests. Health probes and OFF are excluded.

Local share means local HTTP attempts / all model HTTP attempts, not decisions.
Recent latency and output tokens/s come from the latest local response within
60 seconds. Output tokens/s divides completion tokens by wall time, including
queue and prefill; it is not GPU decode speed. Missing token counts display —.

Savings are an **estimate**: observed local input/output token counts priced
with the router's existing `anthropicCostUsd()` table and configured
`ANTHROPIC_MODEL` (default Sonnet). Different tokenizers may produce different
cloud usage; hardware/electricity and prompt caching are excluded. The readout
shows the count of metered local attempts and the comparison model. Unknown
prices/usage display —. No independent price table is maintained here.

**Scope:** observations are local to this web server's routing process and reset
on restart. A separately running orchestrator's receipts are not aggregated;
an idle/cold web process honestly displays no receipts. Explicitly constructed
routers have their own windows. Preview/replay scenes still label this rack as
live GX10 telemetry, independent of fixture office state. Nothing here proves
all finance work stayed local: the existing router permits cloud fallback, and
the readout discloses that task input can leave the site on fallback.

## Verification

```sh
pnpm --filter @backroom/web exec vitest run lib/gx10
pnpm --filter @backroom/orchestrator exec vitest run src/router
pnpm --filter @backroom/web typecheck
pnpm --filter @backroom/orchestrator typecheck
LIVE_GX10=1 pnpm --filter @backroom/orchestrator exec tsx ../web/scripts/gx10-live.ts
```

The live script is opt-in and read-only: no inference, cloud spend, or secrets.
Observed 2026-10-24 13:14:40 UTC: GX10 reachable, `/api/ps` reported
`gpt-oss:20b` and `gpt-oss:120b` loaded. This is a dated check; the product probes
fresh state instead of replaying it.

For a headless scene check, start a task-owned web server, then run:

```sh
GX10_BROWSER_URL=http://127.0.0.1:3197 pnpm --filter @backroom/web exec node scripts/gx10-browser.mjs
```

This browser check mocks `/api/gx10`: it verifies online metrics, measurement
and fallback disclosures, offline clearing, viewport bounds, and no page errors.
It is separate from the real GX10 probe above. The readout uses a task-owned DOM
root projected from the scene anchor; its lifecycle is deferred past Canvas
commits to avoid React concurrent-root unmount races.
