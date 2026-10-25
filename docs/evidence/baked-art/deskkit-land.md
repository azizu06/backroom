# Desk kit on the refreshed open office (U1)

The planner supplied the merged base (`00fad9a`, including main through `e9f074c`). This dispatch performed no git writes, dependency installation, bake, or external network access. `layout.ts` stayed read-only. The board was not contacted because this dispatch explicitly prohibited network access.

The registered desk mount retains the original procedural renderer until a complete kit batch is committed. Once ready, all permanent `WORKSTATIONS` receive a desk, chair, keyboard and monitor shell, even before department rows arrive. Procedural screen transforms and materials remain intact. Placement IDs use workstation IDs; centers and facing come from `WORKSTATIONS`. Department anchors select chair tint only. The room-scoped helper remains available for department views and Treasury props.

The registry uses the kit-aware desk mount from the allowed `DeskKit.tsx` path; the existing `Desks.tsx` remains the fallback. No unrelated mount or layout changes were needed.

Coverage includes the current twelve workstations, a reordered synthetic six-pod layout (24 desks), full GLB geometry bounds inside the room, ready/fallback rendering, unchanged procedural screen transforms, missing templates, GLB parsing and manifest names. Browser checks cover the disabled flag, delayed load, failed load and Play performance.

Main deliberately retired the incompatible baked lobby shell (`wing.test.ts`). The baked fallback browser spec now opens preview controls through Full Floor and verifies that the procedural audit board and denial stamp survive both successful and failed kit loads. It also checks that loading the kit does not request the retired lobby shell.

## Asset integrity

- `deskkit.glb`: unchanged, 573148 bytes; SHA-256 `8490b60d31fd9e46315064323a64238e5630d0be6450ef1230744f625c84b9af`.
- `character.glb`: main's version retained unchanged, 512928 bytes; SHA-256 `f173d48c5bd234fee185d6bf8b34e3c804f5646a2250c4733725b7abba0031ef`.
- `deskkit.nodes.json`: recovered from the existing GLB, with the bake manifest's bounds/material fields plus its SHA-256. All 22 root node names match `DESKKIT_NODES`. No new third-party assets.

## Local verification

Commands run from `web/` unless noted. Browser routes reject non-loopback hosts.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm run typecheck` | 0 | Route generation and TypeScript pass (also repeated after adding tests). |
| `pnpm exec vitest run --globals lib/office` | 1 | Initial run: registry source assertion expected local name `Desks`; retained that name via import alias. |
| `pnpm exec vitest run --globals lib/office` | 0 | 90 files, 777 tests pass, including GLB and six-pod coverage. |
| `NEXT_TELEMETRY_DISABLED=1 pnpm run build` | 1 | Sandbox blocked child-process pipes (EPERM), leaving Next.js TypeScript `--showConfig` output empty. |
| `NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next build` | 1 | Same sandbox pipe restriction; direct Node invocation did not resolve it. |
| `NEXT_TELEMETRY_DISABLED=1 pnpm run build` | 0 | Passed with approved local subprocess permissions. Existing unrelated dynamic-filesystem tracing warning in `lib/demo/services.ts`. |
| `NEXT_TELEMETRY_DISABLED=1 OFFICE_TEST_PORT=3137 pnpm exec playwright test --config playwright.office.config.ts tests/office-baked-fallback.spec.ts tests/office-deskkit-perf.spec.ts tests/office-deskkit-fallback.spec.ts` | 1 | Initial browser run: all 3 kit readiness/fallback tests and the perf test passed; 2 obsolete lobby tests failed looking for preview controls. |
| `NEXT_TELEMETRY_DISABLED=1 OFFICE_TEST_PORT=3137 pnpm exec playwright test --config playwright.office.config.ts tests/office-baked-fallback.spec.ts` | 0 | Both corrected fallback tests pass (2/2). All six browser cases now pass across the two runs. |
| `pnpm run typecheck && git diff --check` | 0 | Final TypeScript and whitespace checks pass after the browser-spec corrections. |
| `git diff --exit-code HEAD -- web/lib/office/layout.ts web/lib/office/palette.ts web/public/office-art/deskkit.glb web/public/office-art/character.glb` (repo root) | 0 | Protected layout/palette and both existing binaries unchanged. |

Performance measured while turning in Play: procedural **228 calls / 14.21 ms**; kit **234 calls / 16.27 ms**. Draw calls remain below the 1.15× gate; frame CPU remains below the existing 1.5×/4 ms tolerance. No performance thresholds were changed.

The successful repeat of the office unit suite used `pnpm --dir web exec vitest run --globals lib/office` from the repository root. Browser and successful build runs used approved subprocess/loopback permissions because the restricted sandbox prevented child-process pipe access. No dependency or configuration changes were needed.
