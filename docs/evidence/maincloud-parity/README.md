# Maincloud office parity — 2026-10-24

Real SpacetimeDB Maincloud, full module, production Next.js, headless Chromium.
The browser ran on the Mac; this is hosted-state proof, not GX10 web-host proof.

- [Machine-readable proof](proof.json): ten normalized audit rows match byte for
  byte across browser-closed and browser-open scenarios; both original chains verify.
- [Closed-world catch-up](closed-catchup.png), [denied 3D door](denied-3d.png),
  [denied floor plan](denied-floor-plan.png).
- [Closed audit](closed.audit.json) / [open audit](open.audit.json), with
  [closed](closed.normalized.json) / [open](open.normalized.json) normalized bodies.
  Only timestamps and their derived chain hashes are excluded; IDs are preserved.

20/20 request-start → rendered-frame samples ≤1000 ms. Min 86.2 ms,
upper-middle median 104.3 ms, nearest-rank p95 168.3 ms, max 207.7 ms.
The browser monotonic clock includes outbound/reply subscription network time,
controller/Playwright overhead, DOM commit and two animation frames. Remote
server clocks are never subtracted. This is animation response, not walk
completion or physical display/GPU performance. Full samples are in the proof.

The actual reducer rejected Treasury entry, kept the agent row unchanged and
committed `audit:11`; the office showed the red door. OFF propagated. Anonymous
renderer state writes: zero. Browser errors: zero. Bank/model requests: zero.
No live phone call. Controller/audit unlock uses an ephemeral private code and
publisher credentials remain server-only; screenshots contain synthetic data.

Reproduce from the repo root with CLI 2.13.0 authenticated via browser login:

```sh
pnpm --filter @backroom/web build
DEMO_SPACETIME=maincloud pnpm demo:parity
```

Each invocation publishes fresh `backroom-maincloud-<time>-<random>-closed/open`
databases; no existing state is reset or deleted. CLI config defaults to the
selected `SPACETIME_ROOT`'s config; `SPACETIME_CONFIG` can select a separate private
config. The local default remains `pnpm demo:parity`. Evidence is separate from
`docs/evidence/parity/` so network results never replace local results.
