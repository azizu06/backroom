import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { exportHallLayout } from '../../scripts/export-layout';
import { BUILDING, WALLS, WINDOWS, DOORWAYS, WORKSTATIONS, wallColliders } from './layout';
import { BAKED_REPLACES, HALL_NODES, HIDDEN_IN_OVERVIEW, bakedPieceActive, bakedReplacesHall, setBakedPieceReady, validateHallColliders } from './baked-art';
import { ROOMS } from '../../app/office/mounts/BakedArt';
import { officeColliders } from './play';

const layoutFile = new URL('../../../tools/bake/hall.layout.json', import.meta.url);
const layout = JSON.parse(readFileSync(layoutFile, 'utf8')) as ReturnType<typeof exportHallLayout>;
const glbFile = new URL('../../public/office-art/hall.glb', import.meta.url);
afterEach(() => { setBakedPieceReady('hall', false); setBakedPieceReady('exterior', false); });

describe('hall bake layout contract', () => {
  it('exports the live layout and palette without a second set of room numbers', () => {
    expect(layout).toEqual(exportHallLayout());
    expect(layout.BUILDING).toEqual(BUILDING);
    expect(layout.WALLS).toEqual(WALLS);
    expect(layout.WINDOWS).toEqual(WINDOWS);
    expect(layout.DOORWAYS).toEqual(DOORWAYS);
    expect(layout.POD_BOUNDS.map(p => p.id)).toEqual([...new Set(WORKSTATIONS.map(s => s.pod))]);
    expect(layout.TICKET_BOARD.to - layout.TICKET_BOARD.from).toBe(6);
    expect(layout.TICKET_BOARD.fixed).toBe(BUILDING.minZ);
  });
  it('uses exactly the movement wall colliders, including the closed entrance', () => {
    expect(layout.WALL_COLLIDERS).toEqual(wallColliders());
    expect(validateHallColliders({ room: 'hall', boxes: layout.WALL_COLLIDERS })).toEqual(wallColliders());
    const play = officeColliders([]);
    for (const wall of wallColliders()) expect(play.filter(box => JSON.stringify(box) === JSON.stringify(wall))).toHaveLength(1);
  });
  it.skipIf(!existsSync(glbFile))('validates the delivered GX10 GLB and its companion colliders', () => {
    const bytes = readFileSync(glbFile);
    expect(bytes.length).toBeLessThanOrEqual(2_500_000);
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    expect(bytes.readUInt32LE(16)).toBe(0x4e4f534a);
    const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString()) as {
      nodes: { name: string; mesh?: number }[]; meshes: unknown[]; images: unknown[]; materials: unknown[];
    };
    for (const name of HALL_NODES) expect(gltf.nodes.some(node => node.name === name)).toBe(true);
    expect(gltf.meshes).toHaveLength(9);
    expect(gltf.images).toHaveLength(1);
    expect(gltf.materials).toHaveLength(1);
    const output = new URL('../../public/office-art/hall.colliders.json', import.meta.url);
    expect(validateHallColliders(JSON.parse(readFileSync(output, 'utf8')))).toEqual(wallColliders());
  });
  it('rejects stale, missing, reordered and non-finite collider files before replacement', () => {
    for (const data of [null, {}, { room: 'lobby', boxes: wallColliders() }, { room: 'hall', boxes: [] },
      { room: 'hall', boxes: [...wallColliders()].reverse() },
      { room: 'hall', boxes: wallColliders().map((b, i) => i ? b : { ...b, minX: NaN }) }]) {
      expect(() => validateHallColliders(data)).toThrow(/layout/);
    }
  });

});

describe('hall registration and fallback', () => {
  it('registers the shared hall and Play-only exterior, without the incompatible legacy lobby shell', () => {
    expect(ROOMS.map(r => r.id)).toEqual(['hall', 'exterior']);
    expect(ROOMS.find(r => r.id === 'hall')).toMatchObject({ url: '/office-art/hall.glb', playOnly: false });
    expect(ROOMS.find(r => r.id === 'exterior')).toMatchObject({ url: '/office-art/exterior.glb', playOnly: true });
  });
  it('keeps replacements until hall commits, and restores them on failure/unmount', () => {
    for (const ready of [false, true, false]) {
      setBakedPieceReady('hall', ready);
      const active = bakedPieceActive('?art=baked', 'hall');
      for (const piece of BAKED_REPLACES.hall) expect(bakedReplacesHall(active, piece)).toBe(ready);
      expect(bakedPieceActive('', 'hall')).toBe(false);
    }
    setBakedPieceReady('exterior', true);
    expect(bakedPieceActive('?art=baked', 'hall')).toBe(false);
  });
  it('cuts away the ceiling, beams, lamps and near walls in overview', () => {
    for (const name of ['ceiling', 'beams', 'lamps', 'wall_south', 'wall_east', 'windows']) expect(HIDDEN_IN_OVERVIEW.has(name)).toBe(true);
    expect(HIDDEN_IN_OVERVIEW.has('floor')).toBe(false);
    expect(HIDDEN_IN_OVERVIEW.has('walls')).toBe(false);
  });
});
