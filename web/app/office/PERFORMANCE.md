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

## Square office polish (BR-SQUARE-POLISH)

Source-derived counts for the procedural square office with all rooms visible:

| Submission / light budget | Before | After |
| --- | ---: | ---: |
| First-person shell draws (walls/frames, glass, ceiling, panels) | 4 | 4 |
| Overview shell draws | 1 | 1 |
| Lamp body / shade draws | 2 | 2 |
| Additional draws from ceiling fill | 0 | 0 |
| Lights (hemisphere, two directional, floor pools, ceiling fill) | 5 | 6 |
| Shadow-casting lights | 1 | 1 |
| Low-power lights / shadow casters | 3 / 0 | 3 / 0 |

The sixth light is one shared butter-coloured point fill beneath the ceiling panels,
with no shadows, animation or frame requests. It is omitted in low-power mode.
Existing wall/ceiling batches reuse the cream palette roles with stronger diffuse
emission, and panels reuse the butter lamp role. No geometry or shadow passes were added;
the 1024 directional and 512 contact maps and the 300-draw moving-Play budget are unchanged.

Text wrapping adds no draws or textures. Desk plates grow from 624 × 224 to 624 × 320
and from 1.56 × 0.56 m to 1.56 × 0.8 m, preserving font size and pixel density while
making room for two task/status lines. All backing stores remain below the 1024 cap.

These counts are a source inventory, not new renderer measurements. The planner must
run the perf overlay and square walkthrough against a build. This checkout registers
only `lobby.glb`, not a full baked hall; hiding the entire procedural shell on lobby
readiness would remove the rest of the office, so the existing baked behaviour is retained.
