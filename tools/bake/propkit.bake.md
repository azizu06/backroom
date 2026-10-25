# Prop kit handoff — Phase A complete; bake pending (phase B)

The writer has no network or Blender. `propkit.py` needs only Blender's bundled
`bpy`, `bmesh`, `mathutils` and Python's `math`, `os`, `sys`, `json`. It reads no
assets, writes only `--out`, uses CPU Cycles with denoising disabled, and caps the
single colour+lighting atlas at 1024 px. No new dependencies.

## Phase B: orchestrator on the GX10

Check `nvidia-smi`, `uptime`, `nproc`, and `ollama ps` first. Run only while Ollama
is idle. All uploaded inputs, output, temporary home and logs stay under `~/bake`.
From the desktop repo root:

```sh
ssh gx10 'nvidia-smi; uptime; nproc; ollama ps'
ssh gx10 'mkdir -p ~/bake/in'
scp tools/bake/propkit.py tools/bake/run-gx10.sh gx10:bake/in/
ssh gx10 'bash ~/bake/in/run-gx10.sh ~/bake/in/propkit.py ~/bake/propkit-u1 1024 64 8'
ssh gx10 'tail -30 ~/bake/propkit-u1/log.txt; cat ~/bake/propkit-u1/timing.txt'
scp gx10:bake/propkit-u1/out/propkit.glb web/public/office-art/
scp gx10:bake/propkit-u1/out/propkit.nodes.json web/public/office-art/
scp gx10:bake/propkit-u1/out/propkit.colliders.json web/public/office-art/
scp gx10:bake/propkit-u1/out/propkit_lightmap.png web/public/office-art/
```

The exact runner invocation **on GX10** is:

```sh
bash ~/bake/in/run-gx10.sh ~/bake/in/propkit.py ~/bake/propkit-u1 1024 64 8
```

The runner bind-mounts the supplied script inside the sandbox (under its own name
on the current wrapper), so the command does not depend on its sandbox filename.
It executes `/usr/bin/blender` through PATH with `--background --factory-startup
--disable-autoexec`, `bwrap --unshare-net`, nice 19 and timeout 1800 s. The wrapper
can return zero on a Blender failure: require `PROPKIT_DONE` in the log, all four
files and **no traceback**, not just a successful SSH exit.

Expected output:

- `propkit.glb`: <= 1,500,000 bytes; twelve root mesh nodes at the origin, one shared
  material / embedded PNG atlas, no cameras, lights or external asset URLs.
- `propkit_lightmap.png`: 1024 × 1024 (at most); source atlas also embedded in GLB.
- `propkit.nodes.json`: `kit: propkit`, `lightmap`, `nodes` keyed by name, each with
  actual Y-up `bounds`, conservative local `footprint`, `solid`, and `triangles`.
- `propkit.colliders.json`: `space: node-local`, `boxes` for the seven solid node
  types; runtime rotates/translates these matching envelopes from layout data.
  The web never fetches this file or waits for a GLB to enable collision.

Required names: `plant_tall`, `plant_small`, `bookshelf`, `water_cooler`,
`coffee_station`, `wall_art_a`, `wall_art_b`, `floor_lamp`, `pendant_lamp`,
`rug_large`, `office_tv`, `arcade`.

## Runtime contract / Phase C

`propkitPlacements(layout)` takes building bounds, window spans, doorway openings
and pod boxes. `currentPropKitLayout()` derives pod bounds from WORKSTATIONS and
the existing desk/chair geometry. The non-solid rugs deliberately sit underneath
pods, including their chair approaches; they are the exception to floor-obstacle
clearance. All other placements reserve full doorway openings plus 1.2 m, window
strips, the north centre 6 m and existing wall displays. The two existing fixed
plants remain in their own mount and are reserved as occupied space.

There is no dressing set in the open-office `DRESSING` registry. The PropKit mount
therefore owns a procedural fallback for every added instance. It is visible only
with `?art=baked`, uses the same placement envelopes, and stays until all twelve
textured nodes validate. Missing/partial/bad GLBs cannot leave invisible barriers.
The existing desk kit and lobby readiness contracts are unchanged.

After copying outputs, the writer fix round must:

1. Parse the real GLB and manifest; check all twelve names, one embedded <=1024px
   texture, <=1.5 MB, local origins/bounds/footprints matching PROPKIT_SPECS, and
   instanced scene draw counts. The unit/browser fixtures do not certify a bake.
2. Update `web/app/office/PERFORMANCE.md` with actual GLB bytes, per-node and total
   placed triangles, renderer calls and moving Play samples (<300 calls).
3. Capture equal-camera before/after first-person views at spawn, east wall and a
   pod aisle into `docs/evidence/baked-art/propkit-{spawn,east-wall,pod-aisle}-{before,after}.jpg`.
   Use the same query/layout/state; compare fallback vs completed bake, never an
   old room's different camera.
4. Run from `web/`: `pnpm run typecheck`, `pnpm exec vitest run --globals lib/office`,
   and `pnpm exec playwright test --config playwright.office.config.ts tests/office-baked-fallback.spec.ts`
   after a local production build. Record actual exit codes and visual findings.
