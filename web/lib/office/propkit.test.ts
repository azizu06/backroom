import { describe, expect, it } from 'vitest';
import {
  PROPKIT_NODES, PROPKIT_SPECS, currentPropKitLayout, propkitPlacements, propkitColliderBoxes,
  propPlacementFootprint, propRectsOverlap, propDoorClearance, propWindowClearance, type PropKitLayout,
} from './propkit';
import { PLAYER_RADIUS, insideAny, movePlayer, officeColliders, SERVER_ROOM_BOX } from './play';

const square: PropKitLayout = {
  building: { minX: -12, maxX: 12, minZ: -12, maxZ: 12 },
  windows: [
    { wall: 'north', at: 7, width: 2 }, { wall: 'east', at: -7, width: 2 },
    { wall: 'east', at: 7, width: 2 }, { wall: 'west', at: -7, width: 2 },
    { wall: 'south', at: 8, width: 2 },
  ],
  doorways: [{ id: 'entrance', kind: 'entrance', at: [-5, 12], axis: 'x', width: 2 }],
  pods: [-6, 0, 6].flatMap((x, ix) => [-5, 4].map((z, iz) => ({ id: `${ix}:${iz}`,
    minX: x - 2.3, maxX: x + 2.3, minZ: z - 1.8, maxZ: z + 1.8 }))),
};

for (const [name, layout] of [['current', currentPropKitLayout()], ['square / six pods', square]] as const) {
  describe(`prop placement: ${name}`, () => {
    it('places every named prop, one rug per pod and lamps above the aisles', () => {
      const placements = propkitPlacements(layout);
      expect([...new Set(placements.map(p => p.node))].sort()).toEqual([...PROPKIT_NODES].sort());
      expect(new Set(placements.map(p => p.id)).size).toBe(placements.length);
      const rugs = placements.filter(p => p.node === 'rug_large');
      expect(rugs).toHaveLength(layout.pods.length);
      for (const pod of layout.pods) {
        const footprint = propPlacementFootprint(rugs.find(p => p.id === `rug:${pod.id}`)!);
        for (const edge of ['minX', 'maxX', 'minZ', 'maxZ'] as const) expect(footprint[edge]).toBeCloseTo(pod[edge]);
      }
      const pendants = placements.filter(p => p.node === 'pendant_lamp');
      expect(pendants.length).toBeGreaterThan(2);
      expect(pendants.every(p => p.position[1] >= 2.3)).toBe(true);
      expect(placements.filter(p => p.id.startsWith('entrance:plant:'))).toHaveLength(2);
      const b = layout.building;
      for (const [id, x, z] of [['nw', b.minX, b.minZ], ['ne', b.maxX, b.minZ],
        ['sw', b.minX, b.maxZ], ['se', b.maxX, b.maxZ]] as const) {
        const plant = placements.find(p => p.id === `plant:${id}`)!;
        expect(plant, id).toBeDefined();
        expect(Math.abs(plant.position[0] - x), id).toBeLessThan(2.5);
        expect(Math.abs(plant.position[2] - z), id).toBeLessThan(2.5);
      }
      for (const entrance of layout.doorways.filter(d => d.kind === 'entrance')) {
        for (const plant of placements.filter(p => p.id.startsWith(`${entrance.id}:plant:`)))
          expect(Math.hypot(plant.position[0] - entrance.at[0], plant.position[2] - entrance.at[1])).toBeLessThan(3.2);
      }
    });

    it('keeps full envelopes inside the room, outside pods, doors, windows and the ticket board', () => {
      const placements = propkitPlacements(layout).filter(p => p.node !== 'rug_large');
      const b = layout.building, cx = (b.minX + b.maxX) / 2;
      for (const p of placements) {
        const f = propPlacementFootprint(p);
        expect(f.minX, p.id).toBeGreaterThan(b.minX);
        expect(f.maxX, p.id).toBeLessThan(b.maxX);
        expect(f.minZ, p.id).toBeGreaterThan(b.minZ);
        expect(f.maxZ, p.id).toBeLessThan(b.maxZ);
        for (const forbidden of [...layout.pods, ...(layout.occupied ?? []),
          ...layout.doorways.map(propDoorClearance), ...layout.windows.map(w => propWindowClearance(w, b)),
          { minX: cx - 3, maxX: cx + 3, minZ: b.minZ, maxZ: b.minZ + 0.8 }])
          expect(propRectsOverlap(f, forbidden), p.id).toBe(false);
        for (const other of placements.filter(o => o.id !== p.id))
          expect(propRectsOverlap(f, propPlacementFootprint(other)), `${p.id} / ${other.id}`).toBe(false);
      }
      for (const node of ['bookshelf', 'water_cooler', 'coffee_station'] as const) {
        const p = placements.find(p => p.node === node)!;
        expect(p.position[0]).toBeGreaterThan(b.maxX - 1);
        expect(p.rotation).toBe(-Math.PI / 2);
      }
      const tv = placements.find(p => p.node === 'office_tv')!;
      expect(tv.position[0]).toBeLessThan(b.minX + 0.5);
      const arcade = placements.find(p => p.node === 'arcade')!;
      expect(arcade.position[0]).toBeLessThan(b.minX + 1);
      expect(arcade.position[2]).toBeGreaterThan(b.maxZ - 2);
    });

    it('is deterministic and does not mutate the supplied layout', () => {
      const before = JSON.stringify(layout);
      expect(propkitPlacements(layout)).toEqual(propkitPlacements(layout));
      expect(JSON.stringify(layout)).toBe(before);
    });

    it('only collides with floor props, never rugs, wall art or overhead lamps', () => {
      const placements = propkitPlacements(layout), boxes = propkitColliderBoxes(layout);
      expect(boxes.length).toBeGreaterThan(5);
      for (const p of placements) expect(boxes.some(b => b.name === `propkit:${p.id}`)).toBe(PROPKIT_SPECS[p.node].solid);
    });
  });
}

it('translates with the building instead of retaining any original-room coordinates', () => {
  const shift = (r: PropKitLayout['building']) => ({ minX: r.minX + 40, maxX: r.maxX + 40, minZ: r.minZ - 30, maxZ: r.maxZ - 30 });
  const shifted: PropKitLayout = { building: shift(square.building),
    pods: square.pods.map(p => ({ ...shift(p), id: p.id })),
    windows: square.windows.map(w => ({ ...w, at: w.at + (w.wall === 'north' || w.wall === 'south' ? 40 : -30) })),
    doorways: square.doorways.map(d => ({ ...d, at: [d.at[0] + 40, d.at[1] - 30] })),
  };
  const original = propkitPlacements(square), moved = propkitPlacements(shifted);
  expect(moved.map(p => p.id)).toEqual(original.map(p => p.id));
  moved.forEach((p, i) => {
    expect(p.position[0]).toBeCloseTo(original[i]!.position[0] + 40);
    expect(p.position[2]).toBeCloseTo(original[i]!.position[2] - 30);
  });
});

it('leaves the current cross-office walking route open with or without a GLB', () => {
  const boxes = propkitColliderBoxes();
  const colliders = officeColliders(['lobby', 'collections', 'payables', 'vendor_onboarding', 'dana', 'treasury'], [SERVER_ROOM_BOX, ...boxes]);
  for (let x = -10; x <= 9; x += 0.25) expect(insideAny([x, 0], boxes, PLAYER_RADIUS)).toBe(false);
  expect(movePlayer([-7, 0], [8, 0], colliders, PLAYER_RADIUS)).toEqual([1, 0]);
});
