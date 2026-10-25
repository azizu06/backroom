import { describe, expect, it } from 'vitest';
import { currentWalkLayout } from '../../tests/helpers/office-walk';
import { buildOfficeWalk, frameHasGeometry, planWalkPath, segmentClear, type WalkLayout } from './office-walk';
import { insideAny, movePlayer } from './play';

function squareLayout(): WalkLayout {
  const base = currentWalkLayout();
  const workstations: WalkLayout['workstations'][number][] = [];
  for (let pod = 0; pod < 6; pod++) for (const dx of [-1.2, 1.2]) for (const flip of [-1, 1] as const) {
    workstations.push({ id: `square-${pod}-${dx}-${flip}`, pod, flip,
      center: [(pod % 3 - 1) * 7 + dx, (pod < 3 ? -5 : 5) + flip * 0.6] });
  }
  const colliders = workstations.flatMap(({ center: [x, z], flip }) => {
    const c = base.chair;
    return [
      { minX: x - base.desk.width / 2, maxX: x + base.desk.width / 2, minZ: z - base.desk.depth / 2, maxZ: z + base.desk.depth / 2 },
      { minX: x + c.x * flip - c.width / 2, maxX: x + c.x * flip + c.width / 2,
        minZ: z + c.z * flip - c.depth / 2, maxZ: z + c.z * flip + c.depth / 2 },
    ];
  });
  return { ...base, building: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 }, workstations, colliders,
    spawn: { position: [0, 0], yaw: 0 }, anchors: { operator: { center: [0, -5], position: [0, -2] } },
    boards: [{ id: 'south', position: [0, 11.9] }, { id: 'east', position: [11.9, 0] }],
    doorways: [{ id: 'entry', axis: 'x', at: [0, 12] }, { id: 'west', axis: 'z', at: [-12, 0] }],
  };
}

describe('layout-derived office walkthrough', () => {
  for (const [name, create] of [['current', currentWalkLayout], ['24 x 24 / six pods', squareLayout]] as const) {
    it(`covers every destination with collision-free continuous paths: ${name}`, () => {
      const layout = create(), walk = buildOfficeWalk(layout), spots = walk.stops.map(s => s.spot);
      expect(spots.filter(s => s.kind === 'aisle')).toHaveLength(new Set(layout.workstations.map(s => s.pod)).size * 4);
      expect(spots.filter(s => s.kind === 'seat').map(s => s.id).sort()).toEqual(layout.workstations.map(s => `seat-${s.id}`).sort());
      for (const id of Object.keys(layout.anchors)) expect(spots.find(s => s.id === `anchor-${id}`)?.position).toEqual(layout.anchors[id]!.position);
      for (const door of layout.doorways) expect(spots.some(s => s.id === `doorway-${door.id}`)).toBe(true);
      for (const board of layout.boards) expect(spots.some(s => s.id === `board-${board.id}`)).toBe(true);
      expect(new Set(spots.map(s => s.id)).size).toBe(spots.length);
      expect(walk.stops[0]!.spot.position).toEqual(layout.spawn.position);
      let position = layout.spawn.position;
      for (const { spot, path } of walk.stops) {
        expect(spot.eye).toEqual([spot.position[0], layout.eyeHeight, spot.position[1]]);
        expect(Number.isFinite(spot.yaw)).toBe(true);
        for (const end of path) {
          expect(segmentClear(position, end, layout.colliders, layout.radius)).toBe(true);
          // Current layout additionally exercises the real swept movement API (its bounds are global).
          if (name === 'current') {
            const start = position, n = Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 0.05);
            for (let i = 0; i < n; i++) {
              const next = movePlayer(position, [(end[0] - start[0]) / n, (end[1] - start[1]) / n], layout.colliders);
              expect(insideAny(next, layout.colliders, layout.radius)).toBe(false);
              expect(Math.hypot(next[0] - position[0], next[1] - position[1])).toBeGreaterThan(0);
              position = next;
            }
            expect(position[0]).toBeCloseTo(end[0], 6); expect(position[1]).toBeCloseTo(end[1], 6);
          }
          position = end;
        }
        expect(position).toEqual(spot.position);
      }
    });
  }

  it('is deterministic, hashes geometry changes and never mutates its input', () => {
    const layout = squareLayout(), before = JSON.stringify(layout), first = buildOfficeWalk(layout);
    expect(buildOfficeWalk(layout)).toEqual(first);
    expect(JSON.stringify(layout)).toBe(before);
    expect(buildOfficeWalk({ ...layout, eyeHeight: 1.6 }).hash).not.toBe(first.hash);
    expect(buildOfficeWalk(currentWalkLayout()).hash).not.toBe(first.hash);
  });

  it('routes around obstacles and fails loudly for blocked or disconnected destinations', () => {
    const layout = { building: { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }, radius: 0.28,
      colliders: [{ minX: -1, maxX: 1, minZ: -1, maxZ: 1 }] };
    expect(planWalkPath([-3, 0], [3, 0], layout).length).toBeGreaterThan(1);
    expect(() => planWalkPath([-3, 0], [0, 0], layout)).toThrow('Unstandable');
    expect(() => planWalkPath([-3, 0], [3, 0], { ...layout,
      colliders: [{ minX: -1, maxX: 1, minZ: -5, maxZ: 5 }] })).toThrow('No walkable route');
    expect(() => buildOfficeWalk({ ...squareLayout(), spawn: { position: [99, 99], yaw: 0 } })).toThrow('spawn');
  });

  it('rejects solid/near-solid screenshots and accepts contrasting geometry', () => {
    const pixels = new Uint8Array(100 * 100 * 4).fill(255);
    expect(frameHasGeometry(pixels)).toBe(false);
    pixels[0] = 0;
    expect(frameHasGeometry(pixels)).toBe(false);
    pixels.fill(0, 0, pixels.length / 2);
    expect(frameHasGeometry(pixels)).toBe(true);
    expect(frameHasGeometry([])).toBe(false);
  });
});
