# Office view (#24)

Open `/office` (or `/`) for the low-poly floor. `STATE_STORE=spacetime` selects the
anonymous live source automatically using server-side `SPACETIMEDB_URI` and
`SPACETIMEDB_DATABASE`. Only these two public coordinates reach the browser;
the publisher token never does. Missing live configuration fails instead of
falling back to fixtures. Configure the server environment as described in
[`spacetime/README.md`](../spacetime/README.md).

Explicit `/office?replay=<name>` URLs retain the labeled replay backup and do not
connect to the live source. See [`replay-mode.md`](replay-mode.md).

Memory mode retains the explicitly labeled **Preview · simulated state** producer
for tests and offline layout work. Its controls only change fixture state.

## One subscription, one projection

`web/lib/office/spacetime.ts` implements `OfficeState` using the exported generated
client `@backroom/orchestrator/spacetime-client`. One anonymous subscription covers
`agent`, `room`, `seat`, `badge`, `escalation`, `audit_entry`, `runtime_control`, and
`agent_handoff_public`.
Row callbacks coalesce after each transaction; the immutable cached snapshot feeds
the canvas, floor plan, badges, lobby audit receipts, and inbox receipt summaries.

- Public handoffs (#152) use `handoffId`, bigint-safe `sequence`, `caseDisplayId`,
  seven short role IDs and millisecond `createdAt`/`acceptedAt`/`completedAt`.
  `offered` carries a folder, `accepted` starts receiver work, `completed` finishes
  its turn (neutral “done”, including held/failed/paused outcomes). A separate
  `rejected` row or an in-place offered/accepted → rejected update returns the
  folder with `errorCode` (`CASE_STOPPED` on cancellation/timeout). After delivery,
  B carries it back to A; before delivery, A turns around continuously. Reverse
  `correction=true` rows are amber and labeled “Correction”. Dana requires an open
  escalation or explicit approval evidence in reason/decisionRef. Voices use
  `fromVoiceRole`/`line` verbatim on offered and default off. Summaries count up to
  160 code points, extending the limit to finish any masked token at the boundary.
  `handoffId` stays lossless; it and `decisionRef` are internal and never rendered.
  Rows upsert by `handoffId`; sequence only orders rows, never filters updates.
  Choreography retains all subscribed rows so newer rows cannot evict an unfinished
  walk or hold; rejection returns reserve their actors before later trips.
  The accessible live log mounts while empty, before the first handoff arrives.
  The anonymous subscription unconditionally registers insert/update/delete for
  `agent_handoff_public`; a missing table fails the whole office connection.
  `?handoffs=mock&handoffSpeed=4` includes both in-place stop paths late in each cycle
  (`INV-1046` before acceptance, `INV-1047` after delivery).
- Agents use stored positions and target anchors. `Dana_desk` maps to `dana`;
  recognized desk aliases map to the fixed floor's named anchors. Unknown targets
  are omitted instead of inventing a destination. Arriving never writes state.
- A folder requires a pending escalation from that exact agent and a Dana target.
  A target alone cannot fabricate an escalation. Rooms require room rows; badge
  limits/actions/rooms come from a matching current seat/badge version.
- Red doors require the exact `request_room_entry` DENY audit ID, agent, and room.
  The door pulses red for 4.5 seconds from its server timestamp. Old receipts stay
  on the wall without replaying a fresh flash when the view reconnects.
- The physical audit-wall lines and inbox folder stack also project audit/intake
  rows. The DOM wall shows the last 20 subscribed receipts, including lifecycle
  rows labeled RECORDED. When the lobby `AuditWall` is mounted, preview/replay
  receipts render in a separate `Preview audit receipts` section beside it. The
  full authenticated inspector remains at `/audit`.
- The lobby mounts `InboxTray` for human submissions through `/api/inbox`.
  Subscribed intake summaries come from `submit_inbox_item`, `route_inbox_item`,
  and `judge_inbox_decision` audit receipts. The displayed count is receipt count,
  **not** the size of a private queue. No anonymous subscription reads private
  inbox payloads or credentials. Detailed receipt links open `/audit`.
- Connection becomes live only after the whole subscription applies. Disconnect
  retains visibly stale rows and clears LLM status to unknown; reconnect replaces
  the view from current rows. The LLM switch displays the subscribed flag. Its
  command remains disabled until a trusted controller transport is supplied.

`web/app/office/Office.tsx` exports `Office({ source, onToggleLlm, auditWall,
inboxTray, controls })`. Room presets frame each room; clicking a seat badge opens
its exact limits. Phone/reduced-motion clients start with a fixed camera. The
floor-plan view uses the same snapshot, and WebGL context loss activates it.

## Verification

[`parity.md`](parity.md) records the actual backend/browser proof and screenshots.

```sh
pnpm -r test
pnpm -r typecheck
pnpm -r build
pnpm demo:parity
```

`demo:parity` is an explicit opt-in real-service check. It owns fresh local DBs,
its loopback server, production Next processes, and headless Chromium; it shuts
those down afterward. No shared Chrome session, model, phone, or bank is used.
The pinned CLI setup is in `spacetime/README.md`. Override `SPACETIME_CLI` and
`SPACETIME_ROOT` to reuse a separately installed pinned CLI without changing it.

The older `web/scripts/verify-office.mjs` remains the memory-preview layout check.
Physical-laptop 60 fps and Maincloud latency are separate, unmeasured checks.
