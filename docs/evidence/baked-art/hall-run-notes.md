# BR-ART-HALL-SHELL U1 — local Phase 1 preparation

The writer is explicitly network-disabled. No GX10 command, board API request,
asset transfer, Blender bake, or browser screenshot was performed. Blender is not
installed locally. No hall/exterior GLB, lightmap, or collider output is represented
as baked evidence. GX10 log, timing, bytes and screenshot results remain pending.

The current source is the 24 × 15 m rectangular shared office. `hall.layout.json`
is generated from that source, not the future BR-SQUARE-ROOM layout. Its north
window at x = -0.8 crosses the reserved centre 6 m ticket-board wall span; the JSON
records the conflict and the generator prints a Phase 1 warning. Resolving that
conflict requires the layout owner; `layout.ts` is forbidden to this writer.

The supplied unit's `web/**` permission was used for the necessary scene wiring:
`mounts/index.ts`, `mounts/WorldShell.tsx`, `scene.tsx`, `OfficeLights.tsx` and
`wing.test.ts`, in addition
to the brief's named files. The prior registry deliberately excluded the incompatible
legacy lobby. The restored baked-art mount includes hall and exterior only, keeping
that old shell excluded. Existing lobby helper APIs remain intact.

Wall inner faces follow the brief's BUILDING boundary. Existing movement walls
are centred on that boundary and conservatively extend 8 cm into the room in this
layout; their exact footprints remain authoritative. Because `officeColliders()`
already includes these walls, the hall does not append them again. Its sidecar is
validated before readiness, so there is no movement-barrier change on load/failure.
Floor/rugs are the intended exception to pod clearance; decorations stay out of
the occupied volume and suspended fixtures remain above 2.2 m.

The exporter uses the installed tsx loader directly. The tsx CLI itself failed with
EPERM creating its IPC socket; no dependency was installed. Geometry tests run as
a separate Python unittest command because child-process creation from Vitest is
also denied here. The initial office run also caught the old wing test forbidding
BakedArt by component name; it now verifies the incompatible lobby is absent while
the shared hall mount is registered.

## Completion still required by the orchestrator

1. Run the Phase 1 GX10 smoke via the documented sandbox wrapper when Ollama is idle;
   retain log/timing under ~/bake and record their results here. Inspect/export size,
   lightmap, mesh names, openings and collider equality before copying outputs back.
2. Merge the gated square layout, re-export, resolve the board/window conflict and
   bake hall plus exterior again for Phase 2. Ship the resulting GLB/JSON/PNG files.
3. Run the browser fallback cases, capture matching overview/story-camera before/after
   JPEGs and measure moving Play draw calls against the <300 budget.

Baked nodes use the existing detail layer so the contact-depth pass skips them
(the pass ignores castShadow flags). Hall readiness also refreshes the static
contact map after the procedural shell is hidden or restored.

## Local verification

Commands run from `web/` unless marked repo root:

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm --filter @backroom/orchestrator exec tsx ../web/scripts/export-layout.ts` (root) | 1 | CLI IPC socket denied (EPERM); replaced by the direct loader below |
| `node --import ./orchestrator/node_modules/tsx/dist/loader.mjs web/scripts/export-layout.ts` (root) | 0 | Current JSON exported; board/window Phase 1 warning recorded |
| `python3 -B -m unittest discover -s tools/bake -p 'test_*.py'` (root) | 0 | Six geometry/import checks passed |
| `bash -n tools/bake/run-gx10.sh` (root) | 0 | Wrapper syntax valid |
| `pnpm run typecheck` | 0 | Route generation and TypeScript passed |
| `pnpm exec vitest run --globals lib/office` | 0 | 90 files passed, 778 tests passed; one GX10 artifact test explicitly skipped because hall.glb is absent |
| `pnpm exec playwright test --config playwright.office.config.ts tests/office-baked-fallback.spec.ts --list` | 0 | Three browser cases discovered; not executed (network/server prohibited) |
| `git diff --check` (root) | 0 | No whitespace errors |

The first office run failed on the retired mount assertion and forbidden Python
subprocess spawning; both were resolved before the passing final run above.
