# Office performance

Open `/office?perf=1` in the 3D view. The lazy `Performance` mount samples existing
demand frames and writes an HTML overlay; it never invalidates or polls. Draw calls
and triangles accumulate **all passes**, including directional/contact shadows and
blur. Geometry/texture counts are renderer allocations. CPU average is the last 60
rendered frame durations, measured around Fiber's frame subscribers and renderer;
it excludes idle gaps and does not measure GPU completion.

Source inventory for the default preview (six rooms, three agents, no denial or
escalation), before/after this change:

| Main-camera draws | Before | After |
| --- | ---: | ---: |
| Shared boxes | 1 | 1 |
| Baked desk furniture | 0 | 1 |
| Glossy monitor faces | 4 | 1 |
| Plants | 6 | 2 |
| Whiteboard | 6 | 4 |
| Vault / server / clock / textured screens / avatar legs / contact plane | 25 | 25 |
| Total | 42 | 34 |

These are source-derived submissions before culling, **not measured renderer.info
totals**. Live before/after draw calls, triangles, allocations and frame times were
not collected because this task prohibits browser runs. The overlay is the runtime
measurement path; use the same viewport, full-floor camera and state on both revisions.

Thirty-two desk box transforms leave drei's per-frame instance loop. Baked desk
and marker geometries are disposed when replaced/unmounted; instance buffers have
their own cleanup. Shared primitive geometries/materials live with the lazy app.
Instance colours also tint monitor emission. Tiny monitor faces no longer cast an
extra directional shadow; their larger casings still do. Existing DPR 1–1.5,
1024 directional map and 512 contact map remain within the existing budgets.

`web/tests/office-perf.spec.ts` checks numeric draw calls and page errors. It was
added but not run; use the existing office browser suite when ports are available.

## Moving Play budget (bigger office world)

Measured with `web/tests/office-perf-budget.spec.ts` (`/office?perf=1`, 1440 x 1000, headless Chromium,
walk and turn from the corridor spawn after a 2.5 s warm-up). Draw calls include every pass.

| Moving Play | main (before world) | world, before | world, after |
| --- | ---: | ---: | ---: |
| Draw calls per frame (samples) | 296–434 | 319–360 | 87–186 |
| Frame CPU avg, steady (ms) | ~1.8–3.4 | ~2.4–3.5 | ~2.1–2.5 |

Where the draws went: the contact-shadow depth pass re-rendered every floor-level mesh (~230 draws) on every
frame, although moving the player changes none of it. `OfficeContactShadows` (ContactShadows.tsx) now bakes the
static casters once (again only when the visible rooms, baked art or camera change) and redraws per frame only
the shadow casters wrapped in `ContactDynamic` (avatars, door leaves, handoff walkers, the deny moment, baked
characters). In first person an avatar whose centre and four sides are all behind walls (`sightBlocked`) is
hidden, which drops its ~20 meshes from the main, sun-shadow and contact passes. The budget spec fails above
300 draws.

## Baked shared hall (Phase 1 pipeline, measurements pending)

Source budget: hall uses **9 mesh draws in Play**, **3 in overview** (floor and
north/west walls), one shared material and one lightmap capped at 2048 × 2048.
The `walls` parent has no mesh. The exterior adds **1 draw in Play only**, with a
lightmap capped at 1024 × 1024. Hall replaces the procedural floor instances and
WorldShell batches only after both the GLB and matching wall-collider sidecar load.
There are **0 shadow-pass draws** from either baked piece; their MeshBasicMaterials
use `toneMapped: false`. Desks, boards, agents and live lights stay independent.

| Measurement | Required | Current evidence |
| --- | --- | --- |
| hall.glb bytes | ≤ 2,500,000 | Not baked; artifact test pending |
| hall map | ≤ 2048 × 2048 | Enforced by generator argument clamp |
| exterior map | ≤ 1024 × 1024 | Enforced by generator argument clamp |
| Moving Play all-pass draws | < 300 | Needs GX10 outputs and same-camera browser measurement |

These are source-derived counts, not `renderer.info` measurements. No GLB size,
frame-time improvement, or complete scene budget pass is claimed before the bake.
Run notes: `docs/evidence/baked-art/hall-run-notes.md`.
