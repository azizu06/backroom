import { describe, expect, it } from 'vitest';
import {
  DESKKIT_NODES, TREASURY_VAULT, deskKitPlacements, deskKitReady, deskKitReplaces, kitReplacesDetail, kitSources,
  workstationKitPlacements, missingKitNodes, setDeskKitReady, subscribeDeskKit, type KitSources,
} from './deskkit';
import { OFFICE_ANCHORS, type AnchorId } from './state';
import { DESKS } from './targets/desk';
import { BUILDING, WORKSTATIONS } from './layout';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Box3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MONITOR_FACE } from './props/monitors';

const ALL = Object.keys(OFFICE_ANCHORS) as AnchorId[];
const byId = (rooms: readonly AnchorId[] = ALL, sources?: KitSources) =>
  new Map(deskKitPlacements(rooms, sources).map(p => [p.id, p]));

describe('desk kit anchor mapping', () => {
  it('uses only nodes the bake exports, with unique ids', () => {
    const placements = deskKitPlacements(ALL);
    expect(placements.length).toBeGreaterThan(0);
    for (const p of placements) expect(DESKKIT_NODES).toContain(p.node);
    expect(new Set(placements.map(p => p.id)).size).toBe(placements.length);
  });

  it('puts a desk, chair, monitor and keyboard on every desk anchor', () => {
    const map = byId();
    for (const { id, center: [x, z] } of kitSources().desks.filter(desk => DESKS.includes(desk.room as typeof DESKS[number]))) {
      expect(map.get(`${id}:desk`)?.at).toEqual([x, 0, z]);
      for (const part of ['chair', 'monitor', 'keyboard']) expect(map.get(`${id}:${part}`)?.node).toBe(part);
    }
    const dana = kitSources().desks.find(desk => desk.room === 'dana')!;
    // Both the monitor shell and screen follow the north-facing workstation.
    expect(map.get(`${dana.id}:desk`)?.rotationY).toBeCloseTo(Math.PI);
    expect(map.get(`${dana.id}:monitor`)?.rotationY).toBe(Math.PI);
    const [dx, dz] = OFFICE_ANCHORS.dana.center;
    expect(map.get(`${dana.id}:monitor`)?.at).toEqual([dx - MONITOR_FACE.x, 0.91, dz - MONITOR_FACE.z]);
  });

  it('follows moved and added anchors (a bigger layout needs no kit change)', () => {
    const base = kitSources();
    const moved: KitSources = { ...base, desks: [...base.desks.map(d => d.room === 'payables' ? { ...d, center: [10, -8] as const } : d),
      { id: 'new-station', room: 'collections', center: [20, 20], flip: 1, tint: '#ffffff' }] };
    const placements = deskKitPlacements(ALL, moved);
    expect(placements.find(p => p.id === `${base.desks.find(desk => desk.room === 'payables')!.id}:desk`)?.at).toEqual([10, 0, -8]);
    expect(placements.filter(p => p.node === 'desk' && p.room === 'collections').map(p => p.at)).toContainEqual([20, 0, 20]);
  });

  it('retains the Treasury vault and omits detached floor dressing', () => {
    const map = byId();
    expect(kitSources().shelves).toEqual([]);
    expect(kitSources().plants).toEqual([]);
    expect(map.get('treasury:vault-body')?.at).toEqual([TREASURY_VAULT.x, 0, TREASURY_VAULT.z]);
    expect(map.get('treasury:vault-door')?.at).toEqual([TREASURY_VAULT.x, 0, TREASURY_VAULT.z - TREASURY_VAULT.depth / 2]);
  });

  it('never brings partition art or detached room props back in baked mode', () => {
    expect(kitSources().details).toEqual([]);
    expect(deskKitPlacements(ALL).every(piece => piece.source === 'desk' || piece.source === 'treasury-vault')).toBe(true);
  });

  it('leaves the baked lobby and hidden rooms alone', () => {
    expect(deskKitPlacements(ALL).some(p => p.room === 'lobby')).toBe(false);
    const onlyTreasury = deskKitPlacements(['treasury']);
    expect(onlyTreasury.every(p => p.room === 'treasury')).toBe(true);
    expect(deskKitPlacements([])).toEqual([]);
  });
});

describe('desk kit fallback', () => {
  it('replaces procedural pieces only once the kit is ready, and never in the baked lobby', () => {
    expect(deskKitReplaces(false, 'collections')).toBe(false);
    expect(deskKitReplaces(true, 'collections')).toBe(true);
    expect(deskKitReplaces(true, 'lobby')).toBe(false);
    expect(kitReplacesDetail(true, { kind: 'books', room: 'collections' })).toBe(false);
    expect(kitReplacesDetail(true, { kind: 'mug', room: 'collections' })).toBe(true);
    expect(kitReplacesDetail(false, { kind: 'mug', room: 'collections' })).toBe(false);
  });

  it('reports nodes a partial GLB lacks', () => {
    const placements = deskKitPlacements(ALL);
    expect(missingKitNodes(placements, new Set(DESKKIT_NODES))).toEqual([]);
    expect(missingKitNodes(placements, new Set(DESKKIT_NODES.filter(n => n !== 'chair')))).toEqual(['chair']);
  });

  it('publishes the ready flag to subscribers', () => {
    let calls = 0;
    const off = subscribeDeskKit(() => { calls++; });
    expect(deskKitReady()).toBe(false);
    setDeskKitReady(true);
    setDeskKitReady(true);
    expect(deskKitReady()).toBe(true);
    setDeskKitReady(false);
    off();
    setDeskKitReady(true);
    setDeskKitReady(false);
    expect(calls).toBe(2);
  });
});

const loadKit = async () => {
  const bytes = readFileSync(new URL('../../public/office-art/deskkit.glb', import.meta.url));
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
};

describe('workstation kit and asset contract', () => {
  it('places every permanent workstation regardless of department rows', () => {
    const placements = workstationKitPlacements();
    expect(placements.filter(piece => piece.node === 'desk')).toHaveLength(WORKSTATIONS.length);
    for (const { id, center: [x, z], flip } of WORKSTATIONS) {
      for (const node of ['desk', 'chair', 'monitor', 'keyboard']) {
        expect(placements.filter(piece => piece.id === `${id}:${node}`)).toHaveLength(1);
      }
      expect(placements.find(piece => piece.id === `${id}:desk`)?.at).toEqual([x, 0, z]);
      expect(placements.find(piece => piece.id === `${id}:monitor`)?.rotationY).toBe(flip === -1 ? Math.PI : 0);
    }
  });

  it('fits one complete kit per desk in a synthetic six-pod room, independent of ordering', async () => {
    const stations = [-8, 0, 8].flatMap((x, column) => [-3.5, 3.5].flatMap((z, row) =>
      [-1.2, 1.2].flatMap((dx, seat) => [-1, 1].map(side => ({
        id: `synthetic-${column}-${row}-${seat}-${side}`, center: [x + dx, z + side * 0.6] as const, flip: side as 1 | -1,
      })))));
    const placements = workstationKitPlacements(stations);
    expect(placements.filter(piece => piece.node === 'desk')).toHaveLength(24);
    expect(new Set(placements.map(piece => piece.id)).size).toBe(24 * 4);
    expect(new Map(workstationKitPlacements([...stations].reverse()).map(piece => [piece.id, piece])))
      .toEqual(new Map(placements.map(piece => [piece.id, piece])));
    const gltf = await loadKit();
    for (const station of stations) {
      expect(placements.filter(piece => piece.id === `${station.id}:desk`)).toHaveLength(1);
    }
    for (const placement of placements) {
      const node = gltf.scene.getObjectByName(placement.node)!.clone(true);
      node.position.set(...placement.at);
      node.rotation.y = placement.rotationY;
      node.updateMatrixWorld(true);
      const bounds = new Box3().setFromObject(node);
      expect(bounds.min.x, placement.id).toBeGreaterThanOrEqual(BUILDING.minX);
      expect(bounds.max.x, placement.id).toBeLessThanOrEqual(BUILDING.maxX);
      expect(bounds.min.z, placement.id).toBeGreaterThanOrEqual(BUILDING.minZ);
      expect(bounds.max.z, placement.id).toBeLessThanOrEqual(BUILDING.maxZ);
    }
  });

  it('parses the unchanged GLB and matches the manifest and expected template names', async () => {
    const bytes = readFileSync(new URL('../../public/office-art/deskkit.glb', import.meta.url));
    const manifest = JSON.parse(readFileSync(new URL('../../public/office-art/deskkit.nodes.json', import.meta.url), 'utf8'));
    const gltf = await loadKit();
    expect(bytes.byteLength).toBe(573148);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
    expect(Object.keys(manifest.nodes).sort()).toEqual([...DESKKIT_NODES].sort());
    expect(gltf.scene.children.map(node => node.name).sort()).toEqual([...DESKKIT_NODES].sort());
  });
});
