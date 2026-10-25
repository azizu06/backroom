/** Run from the repo root: node --import ./orchestrator/node_modules/tsx/dist/loader.mjs web/scripts/export-layout.ts */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILDING, WALL_HEIGHT, WALL_THICKNESS, WALLS, WINDOWS, DOORWAYS,
  DOOR_OPENING_HEIGHT, WINDOW_SILL, WINDOW_HEAD, WORKSTATIONS, wallColliders,
} from '../lib/office/layout';
import { workstationPieces } from '../lib/office/furniture';
import { PALETTE, ROLES } from '../lib/office/palette';

export function exportHallLayout() {
  const pods = [...new Set(WORKSTATIONS.map(seat => seat.pod))].map(id => {
    const pieces = WORKSTATIONS.filter(seat => seat.pod === id)
      .flatMap(seat => workstationPieces(seat.center, seat.flip, ROLES.partition));
    const bounds = pieces.map(({ at, size, rotation }) => {
      const yaw = rotation?.[1] ?? 0;
      const x = (Math.abs(Math.cos(yaw)) * size[0] + Math.abs(Math.sin(yaw)) * size[2]) / 2;
      const z = (Math.abs(Math.sin(yaw)) * size[0] + Math.abs(Math.cos(yaw)) * size[2]) / 2;
      return { minX: at[0] - x, maxX: at[0] + x, minZ: at[2] - z, maxZ: at[2] + z, top: at[1] + size[1] / 2 };
    });
    return { id, minX: Math.min(...bounds.map(b => b.minX)), maxX: Math.max(...bounds.map(b => b.maxX)),
      minZ: Math.min(...bounds.map(b => b.minZ)), maxZ: Math.max(...bounds.map(b => b.maxZ)),
      // Floor/rugs are below this clear volume; lamps/beams must be above standing headroom.
      minY: 0.05, maxY: Math.max(2.2, ...bounds.map(b => b.top)) };
  });
  const centre = (BUILDING.minX + BUILDING.maxX) / 2;
  const ticketBoard = { wall: 'north', from: centre - 3, to: centre + 3, fixed: BUILDING.minZ };
  return {
    schemaVersion: 1, BUILDING, WALL_HEIGHT, WALL_THICKNESS, WALLS, WINDOWS, DOORWAYS,
    DOOR_OPENING_HEIGHT, WINDOW_SILL, WINDOW_HEAD, TICKET_BOARD: ticketBoard, POD_BOUNDS: pods,
    WALL_COLLIDERS: wallColliders(), PALETTE, ROLES,
    // Phase 1 preserves CURRENT openings. Phase 2 must resolve these in layout.ts before the final bake.
    BOARD_WINDOW_CONFLICTS: WINDOWS.filter(w => w.wall === ticketBoard.wall
      && w.at + w.width / 2 > ticketBoard.from && w.at - w.width / 2 < ticketBoard.to),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = new URL('../../tools/bake/hall.layout.json', import.meta.url);
  const layout = exportHallLayout();
  writeFileSync(output, `${JSON.stringify(layout, null, 2)}\n`);
  console.log(`Exported ${layout.WALLS.length} walls, ${layout.WINDOWS.length} windows and ${layout.POD_BOUNDS.length} pods to ${fileURLToPath(output)}`);
  if (layout.BOARD_WINDOW_CONFLICTS.length) console.warn('Phase 1: north window intersects ticket-board span; final layout must resolve this before Phase 2.');
}
