# T9 office shell

The home page mounts `MockOffice` from `web/app/office.tsx`. Its controls change an
in-memory agent row. This is explicitly a simulation, with no reducers, model
calls, policy decisions, approvals, or audit writes.

## T8 integration seam

`web/lib/office/state.ts` exports `OfficeState`, `OfficeSnapshot`, `OfficeAgent`,
`AnchorId`, and `OFFICE_ANCHORS`. Replace `<MockOffice />` with
`<Office source={yourAdapter} />`. Do not carry the mock controls into that path.

An adapter implements two stable functions:

```ts
interface OfficeState {
  getSnapshot: () => OfficeSnapshot;
  subscribe: (listener: () => void) => () => void;
}
```

Cache an immutable `{ agent }` snapshot; return the same object until the subscribed
row changes, then replace it and notify listeners. `subscribe` returns cleanup.
Map the server's `id`, `name`, `seatId`, `targetAnchor`, and initial `pos: [x, z]`
into the projection. Current anchor IDs are `collections` and `dana`. Validate or
map incoming anchor IDs at the adapter boundary. No SpacetimeDB SDK is coupled to
the renderer, and no live SpacetimeDB connection is claimed by this PR.

On mount the view starts at `pos`, then follows `targetAnchor`. Later target
changes redirect from the current visual position through the clear aisle. A new
agent ID mounts a new avatar. The walk has no arrival callback or business effect.
It does not create an escalation or infer that an approval exists.

The View selector offers walking with an orbit camera, fixed camera with tweened
movement (no gait), and a 2D floor plan. Reduced-motion preference starts in fixed
camera mode. A render failure or WebGL context loss degrades to the floor plan,
which consumes the same subscribed snapshot.

## Verification

- `pnpm --filter @backroom/web test`: three Vitest tests cover immutable row
  notification/cleanup, continuous aisle travel/arrival, and retargeting with a
  clamped resumed frame. No network calls. Test file: 55 lines; no repeated setup
  or snapshot assertions.
- The web test command enables Vitest globals for the gateway tests inherited
  from main. Gateway files are unchanged.
- `pnpm --filter @backroom/web typecheck` and `pnpm --filter @backroom/web build`.
- After rebasing onto the integrated main: `pnpm -r typecheck`, `pnpm -r test`
  (319 passed: 43 web, 94 policy, 182 orchestrator), `pnpm -r build`, and
  `pnpm --filter @backroom/web test:approvals:browser` (one passkey E2E test) pass.
- Real signed-in Chrome via `chrome-devtools-axi`, `pnpm --filter @backroom/web dev
  --port 3109`: both desk targets, fixed camera, 2D retargeting, and simulated WebGL
  context loss verified. Walking position changed in samples at 52, 303, 554,
  805, 1056, 1306, 1557 and 1808 ms after a mock row change.
- A 180-frame browser RAF sample averaged 120.3 fps (max interval 9.4 ms) on the
  current machine/session; this is not a guarantee for every laptop.
- The 390×844 viewport had no horizontal overflow; both labels and controls fit.
  Console had no errors before the intentionally induced context loss.
- `docs/evidence/t9/office-collections.png` and `office-dana.png` show the two desk
  states (the second in fixed-camera mode). `office-mobile.png` shows the narrow
  layout. Screenshots are endpoint evidence, not a recording of the walk.
- The integrated root layout mounts a fixed real-versus-simulated disclosure.
  The office reserves its measured height so it cannot cover the mock control.
  `office-rebased-desktop.png` and `office-rebased-mobile.png` show this
  integration with the avatar in motion. To reproduce after `pnpm -r build`,
  start `pnpm --filter @backroom/web exec next start --port 3109`, then run
  `pnpm --filter @backroom/web exec node scripts/office-smoke.mjs` (override
  `DEMO_URL` for a different port). This isolated headless browser check covers
  movement, both fallback selections, ten disclosure entries, controls clear of
  the panel, no horizontal overflow, and no page errors at 1440×900 and 390×844.

Scope is T9 only: one floor, two desks, one avatar, and a replaceable subscription.
The larger M10 rooms/badges/audit wall and live T8 wiring belong to later work.
