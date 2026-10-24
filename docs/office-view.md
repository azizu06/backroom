# Office view (#24)

Open `/office` (or `/`) for the low-poly floor. Room presets frame each room;
seat badges open the exact subscribed actions, rooms, limits and policy version.
Phone and reduced-motion clients start with a fixed camera. The floor-plan view
uses the same source and walks; a WebGL context loss switches to it automatically.

## State and controller seam

`web/app/office/Office.tsx` exports `Office({ source, onToggleLlm, auditWall,
inboxTray, controls })`. `source` implements `OfficeState` from
`web/lib/office/state.ts`: cache an immutable `OfficeSnapshot`, return the same
object until rows change, and notify subscribers after updating it. The renderer
never invokes a reducer, gateway, policy engine, model, approval or payment.
Reaching an anchor has no business effect.

The default route is explicitly **Preview · simulated state**. Its producer is
`web/lib/office/preview.ts`; only its two labeled preview buttons append fixture
receipts or change fixture targets. It reads the versioned Northfield policy
fixture for badge values. These are not live policy rows.

At implementation time main exposes the T8 `agent` binding only, not #15's full
policy, badge, audit, escalation and runtime-control subscriptions. Do not treat
T8 as the complete live adapter. Replace the preview route's producer with #15's
projection when those tables land, preserving the `Office` interface:

- Project all agents and their server positions/target anchors. A nonempty
  `escalationId` makes that agent carry a folder. Clear it from server state.
- Project current badge rows, including `policyVersion`; do not recompute limits
  from client constants. Unrecognized server anchors must be handled by the
  adapter, never cast blindly into `AnchorId`.
- Project room-entry denial events with room, agent, audit ID and Unix-ms time.
  A door flashes for 4.5 seconds only if the exact audit ID, agent, room,
  `request_room_entry` action and `DENY` decision match a subscribed audit entry.
  Unmatched events show no denied door. Old receipts remain visible without
  replaying the flash on reconnect.
- Set connection to `live` only after the complete subscription applies, and
  `disconnected` immediately on disconnect. Model controls are disabled unless
  live. Initial LLM state is unknown, not a cached ON claim.
- Bind `onToggleLlm` to authenticated controller transport; await the server and
  let authoritative rows update `llmEnabled`. Never put the gateway bearer
  secret in client props, public env vars or unauthenticated proxy endpoints.
  The existing switch displays unknown until a control value is supplied. The preview has
  no controller transport and shows a disabled unavailable control.
- Supply the merged `AuditWall` as `auditWall` and the inbox UI as `inboxTray`.
  The Lobby inspector has both mount points, and the footer owns the audit wall
  slot. #61 was still open during this implementation; no copied wall or new
  audit API is introduced. RootLayout already mounts `RealVsSim` globally.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm --filter @backroom/web dev --port 3244
# Another terminal:
pnpm --filter @backroom/web exec node scripts/verify-office.mjs
pnpm -r test
pnpm -r build
```

The headless script writes `docs/evidence/office/`: screenshots of each room,
clickable limits, an escalation walk, a denied Treasury entry with receipt, the
floor plan and phone fallback, plus a JSON verification receipt. It intercepts
only the disclosure status read to avoid integration dependencies. It checks
preview target publication under one second, unchanged audit receipts across
view changes, no renderer POSTs, no page errors and no phone overflow. The frame
cadence is measured in headless Chromium; it is not proof of 60 fps on a team's
physical laptop. The server-side 3D-closed business parity run remains an
integration check against #15 and the orchestrator, not a fixture claim.
