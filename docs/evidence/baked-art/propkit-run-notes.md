# Prop kit bake — Phase B / C

The planner reports a successful GX10 bake through `tools/bake/run-gx10.sh`
(exit **0**) and copied all four outputs into `web/public/office-art/`.
Phase C inspected those files locally; it did not rerun Blender or use the network.
Bake duration: **see run notes** (the planner's GX10 `timing.txt`; no numeric
duration was supplied to this fix round).

## Command and sandbox

Reproduction command on the GX10, using the paths from the Phase B handoff:

```sh
bash ~/bake/in/run-gx10.sh ~/bake/in/propkit.py ~/bake/propkit-u1 1024 64 8
```

The runner uses `bwrap --unshare-net --unshare-pid --die-with-parent`, read-only
system/script mounts, a temporary `/tmp`, and one writable run directory under
`~/bake`. The checked-in wrapper binds the supplied `propkit.py` at
`/bake/lobby.py`; this is an internal mount name, not a different input script.
Its Blender invocation is:

```sh
blender --background --factory-startup --disable-autoexec --python /bake/lobby.py -- \
  --out /bake/run/out --size 1024 --samples 64 --threads 8
```

Parameters: Blender 4.0.2, CPU Cycles, denoising disabled, 1024 px atlas,
64 samples, 8 threads, `nice -n 19`, timeout 1800 s. The wrapper records
`log.txt` and `timing.txt` in the run directory. Its shell exit alone does not
certify Blender success because it catches Blender failures; the reported exit
above comes from the planner, and Phase C independently validates the artifacts.

## Delivered outputs

| File under `web/public/office-art/` | Bytes | Verification |
| --- | ---: | --- |
| propkit.glb | 953,688 | glTF 2 binary; below 1,500,000-byte cap |
| propkit.nodes.json | 5,505 | Twelve named nodes; bounds, footprints, solid flags, triangle counts |
| propkit.colliders.json | 914 | `kit: propkit`, `space: node-local`, seven solid boxes |
| propkit_lightmap.png | 603,525 | 1024 × 1024 PNG; byte-identical to the single embedded atlas |

GLB node names match both `propkit.nodes.json` and `PROPKIT_SPECS`:
`plant_tall`, `plant_small`, `bookshelf`, `water_cooler`, `coffee_station`,
`wall_art_a`, `wall_art_b`, `floor_lamp`, `pendant_lamp`, `rug_large`,
`office_tv`, `arcade`. Each is a root mesh at the origin, with one triangle
primitive and the shared lightmap material. Vertex/index data validate the
manifest's bounds and triangle counts. Geometry stays inside the runtime
envelopes using the bake script's existing 5 mm tolerance (arcade trim extends
2 mm beyond its nominal front edge). Collider footprints match the specs exactly;
rotating/translating their corners through `propkitPlacements` reproduces the
runtime boxes.

The GLB contains **4,984 triangles**. The current 24 × 15 m, three-pod layout
places **23 instances / 7,212 triangles**, with **at most 12 main-camera calls**
before culling and no kit shadow submissions. These counts are derived from the
GLB and placement registry, not measured full-scene renderer totals. Per-node
counts and budgets are in `web/app/office/PERFORMANCE.md`.

## Local checks

Run from `web/` during Phase C:

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm run typecheck` | 0 | Next type generation and TypeScript passed |
| `pnpm exec vitest run --globals lib/office` | 0 | 92 files / 804 tests passed, including 17 prop kit bake tests |

The bake tests read all four assets unconditionally, so missing outputs fail
instead of being skipped. `git diff --check` also passed (exit 0, repository root).

No browser server is available in this sandbox. The browser fallback suite
`tests/office-baked-fallback.spec.ts`, moving-Play renderer sampling and screenshots
remain with the planner; no browser pass is claimed here.

## Planner screenshot placeholders

Capture matching first-person cameras, viewport, layout and state, with
`?art=baked`: before = procedural fallback (block only the prop kit request),
after = loaded kit. These filenames are placeholders, not captured images.

| Camera | Before | After |
| --- | --- | --- |
| Spawn | `propkit-before-spawn.jpg` | `propkit-after-spawn.jpg` |
| East wall | `propkit-before-east-wall.jpg` | `propkit-after-east-wall.jpg` |
| Pod aisle | `propkit-before-pod-aisle.jpg` | `propkit-after-pod-aisle.jpg` |

Save the planner's images beside these notes in `docs/evidence/baked-art/`.
