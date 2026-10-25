import { afterEach, describe, expect, it, vi } from 'vitest';
import { DOORWAYS, ROOM_SPAWNS, SPACES } from '../layout';
import { insideAny, interactCandidates, movePlayer, officeColliders, pickTarget, PLAYER_RADIUS } from '../play';
import { SHARED_ROOM_COLLIDERS } from '../shared-rooms';
import { PINGPONG_COLLIDER as table, PINGPONG_TABLE } from './table';
import { pingPongSession } from './session';
import { pingPongTarget } from '../targets/pingpong';

const overlaps = (a: typeof table, b: typeof table) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
afterEach(() => pingPongSession.stop());
describe('break room ping pong integration', () => {
  it('fits the room without overlapping furniture, spawns or door approaches', () => {
    const room = SPACES.break_room.rect;
    expect(table.minX).toBeGreaterThan(room.minX);
    expect(table.maxX).toBeLessThan(room.maxX);
    expect(table.minZ).toBeGreaterThan(room.minZ);
    expect(table.maxZ).toBeLessThan(room.maxZ);
    for (const other of SHARED_ROOM_COLLIDERS) expect(overlaps(table, other)).toBe(false);
    for (const spawn of Object.values(ROOM_SPAWNS)) expect(insideAny(spawn.position, [table], PLAYER_RADIUS)).toBe(false);
    for (const door of DOORWAYS.filter(door => door.joins.includes('break_room'))) {
      const [x, z] = door.at;
      expect(overlaps(table, { minX: x - door.width / 2, maxX: x + door.width / 2, minZ: z - 0.65, maxZ: z + 0.65 })).toBe(false);
    }
  });
  it('is detached from office collisions and Play prompts', () => {
    const colliders = officeColliders([]);
    expect(colliders).not.toContainEqual(table);
    expect(interactCandidates([], []).some(candidate => candidate.target.kind as string === 'pingpong')).toBe(false);
    const point = [PINGPONG_TABLE.x, PINGPONG_TABLE.z] as const;
    expect(insideAny(point, colliders, PLAYER_RADIUS)).toBe(false);
  });
  it('starts and stops a local session with subscription cleanup', () => {
    const listener = vi.fn();
    const unsubscribe = pingPongSession.subscribe(listener);
    pingPongTarget.activate?.({ kind: 'pingpong' });
    expect(pingPongSession.getSnapshot()).toBe(true);
    pingPongSession.start();
    expect(listener).toHaveBeenCalledTimes(1);
    pingPongSession.stop();
    expect(pingPongSession.getSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    pingPongSession.start();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
