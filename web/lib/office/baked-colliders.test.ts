import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLAYER_RADIUS, SERVER_ROOM_BOX, insideAny, movePlayer, officeColliders } from './play';
import {
  LOBBY_COLLIDERS_URL, LOBBY_PROP_BOXES, PROPKIT_PROP_BOXES, footprintToBox, loadLobbyColliderBoxes, lobbyCollisionExtras, parseLobbyColliders, type ColliderBox,
} from './baked-colliders';

const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/office-art/lobby.colliders.json');
const authored = JSON.parse(readFileSync(file, 'utf8')) as unknown;
const NAMES = [
  'coffee_cabinet', 'water_cooler', 'bookshelf', 'floor_plant', 'sofa', 'coffee_table',
  'coat_stand', 'umbrella_stand', 'magazine_table', 'plant_cluster',
] as const;

function boxNamed(boxes: readonly ColliderBox[], name: string): ColliderBox {
  const found = boxes.find(entry => entry.name === name);
  if (!found) throw new Error(`missing ${name}`);
  return found;
}

describe('lobby collider loader', () => {
  it('includes prop-kit collision from the flag even when both GLBs are missing', () => {
    const base = [SERVER_ROOM_BOX];
    expect(lobbyCollisionExtras(false, LOBBY_PROP_BOXES, base, '?art=plain')).toEqual(base);
    expect(lobbyCollisionExtras(false, LOBBY_PROP_BOXES, base, '?art=baked')).toEqual([...base, ...PROPKIT_PROP_BOXES]);
    expect(lobbyCollisionExtras(true, LOBBY_PROP_BOXES, base, '?art=baked')).toEqual([...base, ...LOBBY_PROP_BOXES, ...PROPKIT_PROP_BOXES]);
    const coffee = PROPKIT_PROP_BOXES.find(b => b.name === 'propkit:coffee_station')!;
    const outside: [number, number] = [coffee.minX - 0.7, (coffee.minZ + coffee.maxZ) / 2];
    const blocked = movePlayer(outside, [0.8, 0], lobbyCollisionExtras(false, [], base, '?art=baked'), PLAYER_RADIUS);
    expect(blocked[0]).toBeCloseTo(coffee.minX - PLAYER_RADIUS, 3);
    expect(insideAny(blocked, [coffee], PLAYER_RADIUS)).toBe(false);
  });

  it('parses the authored footprints into collision boxes', () => {
    const boxes = parseLobbyColliders(authored);
    expect(boxes).toEqual(LOBBY_PROP_BOXES);
    expect(boxes.map(entry => entry.name)).toEqual([...NAMES]);
    const sofa = boxNamed(boxes, 'sofa');
    expect(footprintToBox({ name: 'sofa', minX: -7.925, maxX: -7.075, minZ: 2.3, maxZ: 4.2 })).toEqual(sofa);
    const table = boxNamed(boxes, 'coffee_table');
    expect(insideAny([-6.5, 2.4], [table], 0)).toBe(true);
    expect(insideAny([-6.5, 3.5], [table], 0)).toBe(false);
  });

  it('rejects a bad document and an empty footprint', () => {
    expect(() => parseLobbyColliders(null)).toThrow(/object/);
    expect(() => parseLobbyColliders({ boxes: {} })).toThrow(/boxes/);
    expect(() => parseLobbyColliders({ room: 'treasury', boxes: [] })).toThrow(/lobby/);
    expect(() => parseLobbyColliders({ boxes: [{ name: 'gap', minX: 1, maxX: 1, minZ: 0, maxZ: 1 }] })).toThrow(/empty/);
    expect(() => parseLobbyColliders({ boxes: [{ name: 'nan', minX: 'x', maxX: 1, minZ: 0, maxZ: 1 }] })).toThrow(/non-finite/);
    expect(() => footprintToBox({ name: '', minX: 0, maxX: 1, minZ: 0, maxZ: 1 })).toThrow(/name/);
  });

  it('adds the footprints to Play collision only for baked art', async () => {
    const lobby = await loadLobbyColliderBoxes(async url => {
      expect(url).toBe(LOBBY_COLLIDERS_URL);
      return authored;
    });
    const rooms = ['lobby', 'collections', 'payables', 'vendor_onboarding', 'dana', 'treasury'] as const;
    const plain = officeColliders(rooms, [SERVER_ROOM_BOX]);
    const off = officeColliders(rooms, lobbyCollisionExtras(false, lobby, [SERVER_ROOM_BOX]));
    const on = officeColliders(rooms, lobbyCollisionExtras(true, lobby, [SERVER_ROOM_BOX]));
    expect(off).toEqual(plain);
    expect(on).toHaveLength(plain.length + NAMES.length);

    const sofa = boxNamed(lobby, 'sofa');
    const outside: [number, number] = [-6.5, 3.5];
    const blocked = movePlayer(outside, [-1, 0], on, PLAYER_RADIUS);
    const open = movePlayer(outside, [-1, 0], off, PLAYER_RADIUS);
    expect(insideAny(blocked, [sofa], PLAYER_RADIUS)).toBe(false);
    expect(blocked[0]).toBeCloseTo(sofa.maxX + PLAYER_RADIUS, 3);
    expect(insideAny(open, [sofa], 0)).toBe(true);
    expect(blocked[0]).toBeGreaterThan(open[0]);
  });
});
