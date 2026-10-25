# Baked art (opt-in)

Blender-made rooms, baked to a lightmap and exported as GLB, shown with `/office?art=baked`. The procedural scene stays the default and the fallback (`web/app/office/mounts/BakedArt.tsx`).

- `lobby.py`: models the lobby in web-scene coordinates, bakes lighting to one 2048 px lightmap (Cycles CPU, denoising off), exports `lobby.glb` with the map as WebP.
- `deskkit.py`: no bake, no lightmap. Builds separate named props (desk, chair, monitor, keyboard, desk_lamp, filing_cabinet, bookshelf, plant_small/medium/large, whiteboard, wall_art, rug, mug, tray, vault_body, vault_door, safe, meeting_table, kitchen_counter, kettle, fridge), origin at the floor contact, front +z, a vertex contact-shadow term in `ao`; exports `deskkit.glb` and `deskkit.nodes.json`. The web registry `web/lib/office/deskkit.ts` places them on the procedural anchors and recolours materials named `tint`. Bake like the lobby, then `scp gx10:bake/<run>/out/deskkit.glb web/public/office-art/`.
- `run-gx10.sh`: runs a script on the GX10 inside `bwrap` (no network, read-only system and script, one writable dir under `~/bake`, `nice -n 19`, `timeout 1800`).

Bake (from the desktop; check `nproc`, `uptime`, `nvidia-smi` and Ollama first, and only run when the box is quiet):

```
ssh gx10 'mkdir -p ~/bake/in'
scp tools/bake/lobby.py tools/bake/run-gx10.sh gx10:bake/in/
ssh gx10 'bash ~/bake/in/run-gx10.sh ~/bake/in/lobby.py ~/bake/run1 2048 256 8'
scp gx10:bake/run1/out/lobby.glb web/public/office-art/lobby.glb
```

Inspect the GLB (size, parses, only the expected nodes) before committing. Scripts are our own code only: no downloads, no subprocess, socket, urllib, requests or exec.

Node names the web layer relies on: `shell`, `wall_far`, `wall_near`, `ceiling`. `wall_near` and `ceiling` are hidden in the orthographic overview and shown in first-person Play. The ceiling panels, downlights and pendants are joined into `ceiling` so they hide with it. `lobby.colliders.json` is written by the script (no bake needed to know it) and mirrored in `web/public/office-art/`.

`character.py` (no lightmap, seconds to run): one rigged base body (`body`, `skin`, `hair`, `legs`, `face`, armature `rig`), per-role accessories named `v_<variant>_<item>` (collections, payables, vendor, dana) and four looping clips `idle`, `walk`, `talk`, `type`. Bake it with the same runner (`run-gx10.sh ~/bake/in/character.py ~/bake/char1`), copy `out/character.glb` to `web/public/office-art/`, and check it has the four animations and stays under 2 MB. The web mapping lives in `web/lib/office/baked-character.ts`.

## Shared hall (two phases)

`hall.py` replaces the retired enclosed lobby in the open-office registry. `exterior.py`
adds a Play-only backdrop, entirely outside `BUILDING` expanded by 0.5 m. Both read
**only** `hall.layout.json`; neither imports another bake script or loads assets.
Allowed imports are `bpy`, `mathutils`, `math`, `os` (output paths/directories only),
`sys` (arguments), and `json`. No network, process execution, `eval`/`exec`, or reads
other than that JSON. All generated files go under the required `--out` directory.

Export the live layout from the repo root (uses the already installed TS loader,
without the tsx CLI's IPC server):

```sh
node --import ./orchestrator/node_modules/tsx/dist/loader.mjs web/scripts/export-layout.ts
python3 -B -m unittest discover -s tools/bake -p 'test_*.py'
```

The JSON includes walls, door/window heights, colliders, palette, the centre 6 m
north-wall board span, and bounds computed from every pod's actual furniture.
Floor/rugs are below the occupied pod volume; hanging fixtures are above 2.2 m.
The wall inner faces are on `BUILDING`; their thickness extends outward. Movement
still uses the layout's existing conservative wall footprints, exactly once.
The hall collider sidecar must equal `wallColliders()` before the GLB becomes ready.
The loader keeps the procedural shell on a missing/bad GLB or missing/stale sidecar.

Phase 1 uses the current rectangular layout. Its north window at x = -0.8 overlaps
the reserved board span. This is exported as `BOARD_WINDOW_CONFLICTS`, and the script
logs `PHASE_1_ONLY`; do not present this test bake as the final square-room bake.
After BR-SQUARE-ROOM lands, re-export the JSON and resolve any remaining conflicts
in the owning layout task before Phase 2. Do not hand-edit the exported JSON.

Authorized GX10 operator procedure (not run by the network-disabled writer):

```sh
ssh gx10 'uptime; nvidia-smi; pgrep -af ollama'
# Also inspect Ollama's active requests/load with its owner; only proceed when idle.
ssh gx10 'mkdir -p ~/bake/in'
scp tools/bake/hall.py tools/bake/exterior.py tools/bake/hall.layout.json tools/bake/run-gx10.sh gx10:bake/in/
ssh gx10 'bash ~/bake/in/run-gx10.sh ~/bake/in/hall.py ~/bake/hall-phase1 2048 256 8'
ssh gx10 'bash ~/bake/in/run-gx10.sh ~/bake/in/exterior.py ~/bake/exterior-phase1 1024 128 8'
scp gx10:bake/hall-phase1/out/hall.glb gx10:bake/hall-phase1/out/hall.colliders.json gx10:bake/hall-phase1/out/hall_lightmap.png web/public/office-art/
scp gx10:bake/exterior-phase1/out/exterior.glb gx10:bake/exterior-phase1/out/exterior.bounds.json gx10:bake/exterior-phase1/out/exterior_lightmap.png web/public/office-art/
ssh gx10 'cat ~/bake/hall-phase1/timing.txt ~/bake/hall-phase1/log.txt'
```

Read logs remotely and transcribe timing/results into run notes; copy back only
GLB/JSON/PNG. The runner mounts each script under its own basename, and the JSON
read-only alongside it. It preserves `--unshare-net`, nice 19, the 1800 s timeout,
factory startup, disabled autoexec and a maximum of eight CPU threads. Python errors
and timeout failures now propagate as nonzero exits. Use fresh run directories so
failed runs cannot be mistaken for older successful outputs.

Hall nodes: `floor`, `walls` (empty parent), `wall_north`, `wall_south`, `wall_east`,
`wall_west`, `ceiling`, `beams`, `windows`, `lamps`. Overview hides the ceiling,
beams, lamps, window frames and south/east walls. All nine mesh nodes share one
lightmap (maximum 2048 square); the web material is unlit, `toneMapped: false`,
and neither casts nor receives shadows. The exterior is one mesh with one map
(maximum 1024 square), loaded only with the perspective Play camera.

Before accepting the outputs, run `pnpm exec vitest run --globals lib/office` from
`web/` (the artifact test checks GLB size <= 2,500,000 bytes, nodes and collider equality
once files exist), `pnpm run typecheck`, and the office Playwright fallback spec.
Capture real `hall-before-overview.jpg`, `hall-after-overview.jpg`, and paired
`hall-{before,after}-<story-anchor>.jpg` frames in `docs/evidence/baked-art/` from the
same story anchors. Record measured renderer draw calls with `?perf=1`, asset bytes,
and GX10 wall-clock time; do not substitute the synthetic fallback-test GLB for art evidence.
