import { describe, expect, it } from 'vitest';
import {
  DESKKIT_NODES, KIT_SHELF_WIDTH, TREASURY_VAULT, deskKitPlacements, deskKitReady, deskKitReplaces, kitReplacesDetail, kitSources,
  missingKitNodes, setDeskKitReady, subscribeDeskKit, type KitSources,
} from './deskkit';
import { OFFICE_ANCHORS, type AnchorId } from './state';
import { DESKS } from './targets/desk';
import { DRESSING } from './props/dressing';
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
    for (const room of DESKS) {
      const [x, z] = OFFICE_ANCHORS[room].center;
      expect(map.get(`${room}:desk`)?.at).toEqual([x, 0, z]);
      for (const part of ['chair', 'monitor', 'keyboard']) expect(map.get(`${room}:${part}`)?.node).toBe(part);
    }
    // Dana's desk turns round, but its live screen (and so the casing) still faces +z.
    expect(map.get('dana:desk')?.rotationY).toBeCloseTo(Math.PI);
    expect(map.get('dana:monitor')?.rotationY).toBe(0);
    const [dx, dz] = OFFICE_ANCHORS.dana.center;
    expect(map.get('dana:monitor')?.at).toEqual([dx - MONITOR_FACE.x, 0.91, dz - MONITOR_FACE.z]);
  });

  it('follows moved and added anchors (a bigger layout needs no kit change)', () => {
    const base = kitSources();
    const moved: KitSources = { ...base, desks: [...base.desks.map(d => d.room === 'payables' ? { ...d, center: [10, -8] as const } : d),
      { room: 'collections', center: [20, 20], flip: 1, tint: '#ffffff' }] };
    const placements = deskKitPlacements(ALL, moved);
    expect(placements.find(p => p.id === 'payables:desk')?.at).toEqual([10, 0, -8]);
    expect(placements.filter(p => p.node === 'desk' && p.room === 'collections').map(p => p.at)).toContainEqual([20, 0, 20]);
  });

  it('maps shelves, floor plants and the Treasury vault, scaled to the procedural footprints', () => {
    const map = byId();
    const shelf = DRESSING.shelves.findIndex(s => s.room === 'collections');
    expect(map.get(`collections:shelf:${shelf}`)).toMatchObject({ node: 'bookshelf', scale: [DRESSING.shelves[shelf]!.width / KIT_SHELF_WIDTH, 1, 1] });
    const plant = DRESSING.plants.findIndex(p => p.room === 'treasury');
    expect(map.get(`treasury:floor-plant:${plant}`)).toMatchObject({ node: 'plant_large', scale: [0.6, 0.6, 0.6] });
    expect(map.get('treasury:vault-body')?.at).toEqual([TREASURY_VAULT.x, 0, TREASURY_VAULT.z]);
    expect(map.get('treasury:vault-door')?.at).toEqual([TREASURY_VAULT.x, 0, TREASURY_VAULT.z - TREASURY_VAULT.depth / 2]);
  });

  it('maps room details onto their kit props at their contact points', () => {
    const map = byId();
    expect(map.get('collections:rug')).toMatchObject({ node: 'rug', scale: [0.65, 1, 1.2] });
    expect(map.get('collections:mug')).toMatchObject({ node: 'mug' });
    expect(map.get('collections:mug')?.at[1]).toBeCloseTo(0.91);
    expect(map.get('collections:papers')?.node).toBe('tray');
    expect(map.get('collections:lamp')?.node).toBe('desk_lamp');
    expect(map.get('collections:art')?.node).toBe('wall_art');
    expect(map.get('collections:books')).toBeUndefined();
    expect(map.get('treasury:plant')?.node).toBe('plant_medium');
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
