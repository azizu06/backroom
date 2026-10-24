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
