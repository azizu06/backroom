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
  it('uses the merged square hall and avoids the northwest plant at the old notice approach', () => {
    const layout = currentWalkLayout();
    expect(layout.building).toEqual({ minX: -12, maxX: 12, minZ: -12, maxZ: 12 });
    expect(new Set(layout.workstations.map(s => s.pod)).size).toBe(6);
    expect(layout.spawn.position).toEqual([0, 10.8]);
    const plant = { minX: -11.8, maxX: -10.8, minZ: -11.8, maxZ: -10.8 };
    expect(layout.colliders).toContainEqual(plant);
    expect(insideAny([-10.7, -10.89], [plant], layout.radius)).toBe(true);
    const notice = buildOfficeWalk(layout).stops.find(s => s.spot.id === 'board-notice')!.spot;
    expect(insideAny(notice.position, layout.colliders, layout.radius + 0.025)).toBe(false);
    expect(notice.position[0]).toBeGreaterThan(-10.7);
    expect(segmentClear(notice.position, layout.boards.find(b => b.id === 'notice')!.position, [plant], 0)).toBe(true);
  });

  for (const [name, create] of [['current', currentWalkLayout], ['24 x 24 / six pods', squareLayout]] as const) {
    it(`covers every destination with collision-free continuous paths: ${name}`, () => {
      const layout = create(), walk = buildOfficeWalk(layout), spots = walk.stops.map(s => s.spot);
      expect(spots.filter(s => s.kind === 'aisle')).toHaveLength(new Set(layout.workstations.map(s => s.pod)).size * 4);
      expect(spots.filter(s => s.kind === 'seat').map(s => s.id).sort()).toEqual(layout.workstations.map(s => `seat-${s.id}`).sort());
      for (const id of Object.keys(layout.anchors)) expect(spots.find(s => s.id === `anchor-${id}`)?.position).toEqual(layout.anchors[id]!.position);
      for (const { id, target } of [
        ...layout.doorways.map(d => ({ id: `doorway-${d.id}`, target: d.at })),
        ...layout.boards.map(b => ({ id: `board-${b.id}`, target: b.position })),
      ]) {
        const spot = spots.find(s => s.id === id)!;
        expect(spot).toBeDefined();
        expect(Math.hypot(spot.position[0] - target[0], spot.position[1] - target[1])).toBeLessThanOrEqual(2);
        expect(insideAny(spot.position, layout.colliders, layout.radius + 0.025)).toBe(false);
      }
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

  it('is deterministic, hashes geometry changes and never mutates either layout', () => {
    for (const layout of [currentWalkLayout(), squareLayout()]) {
      const before = JSON.stringify(layout), first = buildOfficeWalk(layout);
      expect(buildOfficeWalk(layout)).toEqual(first);
      expect(JSON.stringify(layout)).toBe(before);
      expect(buildOfficeWalk({ ...layout, eyeHeight: 1.6 }).hash).not.toBe(first.hash);
    }
    expect(buildOfficeWalk(currentWalkLayout()).hash).not.toBe(buildOfficeWalk(squareLayout()).hash);
  });

  for (const kind of ['board', 'doorway'] as const) {
    const mount = { minX: -12, maxX: 12, minZ: -12.08, maxZ: -11.92 };
    const approachLayout = (obstacles: WalkLayout['colliders']): WalkLayout => ({
      ...squareLayout(), workstations: [], anchors: {}, colliders: [mount, ...obstacles],
      boards: kind === 'board' ? [{ id: 'test', position: [0, -12] }] : [],
      doorways: kind === 'doorway' ? [{ id: 'test', axis: 'x', at: [0, -12] }] : [],
    });
    const approach = (layout: WalkLayout) => buildOfficeWalk(layout).stops.find(s => s.spot.kind === kind)!.spot.position;

    it(`finds the nearest clear tile along the wall for an occupied ${kind} approach`, () => {
      const position = approach(approachLayout([{ minX: -0.15, maxX: 0.15, minZ: -11.4, maxZ: -10.8 }]));
      expect(Math.abs(position[0])).toBeCloseTo(0.5);
      expect(position[1]).toBeCloseTo(-12 + (kind === 'board' ? 1 : 0.9));
    });

    it(`rejects clear tiles with occluded sightlines to a ${kind}`, () => {
      const obstacle = { minX: -0.2, maxX: 0.2, minZ: -11.55, maxZ: -11.45 };
      const layout = approachLayout([obstacle]);
      expect(insideAny([0, -11], layout.colliders, layout.radius + 0.025)).toBe(false);
      expect(segmentClear([0, -11], [0, -11.919], layout.colliders, 0)).toBe(false);
      const position = approach(layout);
      expect(Math.abs(position[0])).toBeGreaterThan(0.2);
      expect(segmentClear(position, [0, -11.919], layout.colliders, 0)).toBe(true);
    });

    it(`accounts for ${kind} depth and connected projecting trim`, () => {
      const layout = approachLayout([
        { minX: -1, maxX: 1, minZ: -12, maxZ: -11.3 },
        { minX: -0.5, maxX: 0.5, minZ: -11.4, maxZ: -11.1 },
      ]);
      const position = approach(layout);
      expect(position[1]).toBeGreaterThan(-11.1 + layout.radius + 0.025);
      expect(segmentClear(position, [0, -11.099], layout.colliders, 0)).toBe(true);
    });

    it(`reports obstructing boxes only when no ${kind} approach with sight exists within 2 m`, () => {
      const blocker = { minX: -2.1, maxX: 2.1, minZ: -11.55, maxZ: -11.45 };
      expect(() => approach(approachLayout([blocker]))).toThrow(`No clear approach with sightline to ${kind}-test within 2 m`);
      expect(() => approach(approachLayout([blocker]))).toThrow(JSON.stringify(blocker));
    });
  }

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
