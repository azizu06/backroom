import { BAKED_ROOMS } from './baked-art';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BUILDING, MAIN_BUILDING, ROOM_SPAWNS } from './layout';
import { insideAny, officeColliders, PLAYER_RADIUS } from './play';

const mounts = readFileSync(new URL('../../app/office/mounts/index.ts', import.meta.url), 'utf8');
describe('retired private wing and leisure mounts', () => {
  it('removes the wing, indoor trees, lounge, ping pong and incompatible baked lounge shell', () => {
    expect(BUILDING).toEqual(MAIN_BUILDING);
    expect(BAKED_ROOMS.map(room => room.id)).not.toContain('lobby');
    for (const component of ['WorkRoom', 'Atrium', 'SharedRooms', 'PingPong', 'InteractiveDoors', 'Doors']) {
      expect(mounts).not.toContain(`Component: ${component} }`);
    }
    for (const component of ['Desks', 'AuditWallMount', 'InboxTrayMount', 'HandoffMount', 'DeskKit', 'BakedCharacters', 'BakedArt']) {
      expect(mounts).toContain(`Component: ${component} }`);
    }
  });
  it('redirects legacy wing teleports to clear positions within the office', () => {
    const colliders = officeColliders([]);
    for (const id of ['atrium', 'work_room'] as const) {
      const { position } = ROOM_SPAWNS[id];
      expect(position[0]).toBeGreaterThan(BUILDING.minX);
      expect(position[0]).toBeLessThan(BUILDING.maxX);
      expect(insideAny(position, colliders, PLAYER_RADIUS)).toBe(false);
    }
  });
});
