import { describe, expect, it } from 'vitest';
import { DOORWAYS, ROOM_SPAWNS, SPACE_IDS, SPACES, WALLS, WINDOWS, type Rect } from './layout';
import { PALETTE } from './palette';
import { insideAny, PLAYER_RADIUS, SERVER_ROOM_BOX } from './play';
import { ROOM_PROP_GROUPS, roomPropColliders } from './room-props';
import { PHONE_INTERACTION } from './props/phone';
import { LOBBY_AUDIT_WALL, LOBBY_BOARD, LOBBY_KIOSK } from './layout';

const overlaps = (a: Rect, b: Rect) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
describe('additional room props', () => {
  it('furnishes all eight remaining spaces with palette-only instanced primitives inside their bounds', () => {
    expect(ROOM_PROP_GROUPS.map(group => group.room).sort()).toEqual(
      ['lobby', 'collections', 'payables', 'vendor_onboarding', 'dana', 'treasury', 'server_room', 'corridor'].sort());
    for (const group of ROOM_PROP_GROUPS) for (const piece of group.pieces) {
      const cos = Math.abs(Math.cos(piece.rotation?.[1] ?? 0)), sin = Math.abs(Math.sin(piece.rotation?.[1] ?? 0));
      const hx = (piece.size[0] * cos + piece.size[2] * sin) / 2;
      const hz = (piece.size[0] * sin + piece.size[2] * cos) / 2;
      const bounds = SPACES[group.room].rect;
      expect(piece.at[0] - hx).toBeGreaterThan(bounds.minX);
      expect(piece.at[0] + hx).toBeLessThan(bounds.maxX);
      expect(piece.at[2] - hz).toBeGreaterThan(bounds.minZ);
      expect(piece.at[2] + hz).toBeLessThan(bounds.maxZ);
      expect(Object.values(PALETTE)).toContain(piece.color);
      expect(piece.size.every(size => size > 0 && Number.isFinite(size))).toBe(true);
    }
  });

  it('leaves doorway approaches, spawns, corridor centre and interactive objects clear', () => {
    const colliders = roomPropColliders(SPACE_IDS);
    for (const door of DOORWAYS) expect(insideAny(door.at, colliders, PLAYER_RADIUS + 0.3), door.id).toBe(false);
    for (const spawn of Object.values(ROOM_SPAWNS)) expect(insideAny(spawn.position, colliders, PLAYER_RADIUS), spawn.space).toBe(false);
    for (const point of [PHONE_INTERACTION.position, LOBBY_BOARD, LOBBY_KIOSK, [LOBBY_AUDIT_WALL.x, LOBBY_AUDIT_WALL.z]] as const) {
      expect(insideAny(point, colliders, 0.55)).toBe(false);
    }
    for (const collider of colliders) {
      expect(overlaps(collider, SERVER_ROOM_BOX)).toBe(false);
      expect(overlaps(collider, { minX: SPACES.corridor.rect.minX, maxX: SPACES.corridor.rect.maxX, minZ: -0.7, maxZ: 0.7 })).toBe(false);
    }
  });

  it('keeps every shelf and its wall display away from exterior windows', () => {
    for (const group of ROOM_PROP_GROUPS) for (const piece of group.pieces) for (const window of WINDOWS) {
      const wall = WALLS.find(wall => wall.id === window.wall)!;
      const cos = Math.abs(Math.cos(piece.rotation?.[1] ?? 0)), sin = Math.abs(Math.sin(piece.rotation?.[1] ?? 0));
      const hx = (piece.size[0] * cos + piece.size[2] * sin) / 2;
      const hz = (piece.size[0] * sin + piece.size[2] * cos) / 2;
      const along = wall.axis === 'x' ? piece.at[0] : piece.at[2];
      const across = wall.axis === 'x' ? piece.at[2] : piece.at[0];
      const halfAlong = wall.axis === 'x' ? hx : hz, halfAcross = wall.axis === 'x' ? hz : hx;
      expect(Math.abs(across - wall.fixed) < halfAcross + 0.15 && Math.abs(along - window.at) < halfAlong + window.width / 2).toBe(false);
    }
  });
});
