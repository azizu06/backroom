# Office

## How to add an office feature

Add one new file, then add one line to a registry. Leave `Office.tsx`, `scene.tsx`, `play.ts` and `PlayHud.tsx` alone.

| You want to add | New file | One registry line |
| --- | --- | --- |
| A 3D piece (furniture, room, sign, kiosk) | `web/app/office/mounts/MyThing.tsx` exporting a component that takes `SceneMountProps` (`{ snapshot }`) | `web/app/office/mounts/index.ts`: `{ id: 'my-thing', instanced: false, Component: MyThing }` in `SCENE_MOUNTS` |
| Something you can walk up to and press E on in Play | `web/lib/office/targets/myThing.ts` exporting `defineTarget<{ kind: 'myThing' }>({ id, candidates, label, panel })` (pure, no React) | `web/lib/office/targets/index.ts`: add it to `PLAY_TARGETS` |
| Custom dialog UI for that target (optional) | `web/app/office/panels/MyThingPanel.tsx` exporting a `PlayPanelView` (`Body`, `ownHeading`, `hideAudit`, `hideAskWhy`) | `web/app/office/panels/index.ts`: `myThing: myThingPanel` in `PLAY_PANEL_VIEWS` |
| A view-only prop that reads the snapshot | `web/app/office/props/MyProp.tsx` | `web/app/office/props/OfficeProps.tsx` |

The office is first person only (`web/lib/office/view.ts`): there is no view menu. Room buttons, the tour and story mode are guided walks of the Play camera (`guidePose` in `web/lib/office/play.ts`). The 2D floor plan is drawn only while WebGL is lost or unavailable, and the footer (`#office-text-view`) is the text view that Escape, the HUD's Text view button and the toolbar link lead to.

Rules:

- `instanced: true` mounts render inside the scene's shared box `<Instances>`, so they can use `Block` from `mounts/shared.tsx`. Use `false` for anything with its own meshes and materials.
- Registry order is draw order for mounts. For Play targets, it is the tie-break order (agents always win ties).
- Target modules stay pure: they read the snapshot and never write state, evaluate policy or call a model. Live data (for example GX10) belongs in the panel view.
- Only `scene.tsx` and its imports may load three.js or `@react-three/*`. `Office.tsx`, `PlayHud.tsx`, the split-out Office components and everything in `panels/` are in the initial bundle (`web/lib/office/lazy-scene.test.ts`).
- If the piece is solid in Play, pass its footprint to `officeColliders(rooms, extra)` (see `SERVER_ROOM_BOX`) instead of editing the built-in list.
