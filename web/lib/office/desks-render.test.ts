import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Desks } from '../../app/office/mounts/Desks';
import type { FurniturePiece } from './furniture';
import { deskKitPlacements } from './deskkit';
import { ANCHOR_IDS, WORKSTATIONS } from './layout';
import { insideAny, officeColliders } from './play';
import { INITIAL_OFFICE, visibleRooms, type OfficeSnapshot } from './state';

// Observe the actual mount's batches without WebGL or loading the opt-in GLB.
const batches = vi.hoisted(() => ({
  kitReady: false,
  boxes: vi.fn((_props: { pieces: readonly FurniturePiece[] }) => null),
  screens: vi.fn((_props: { pieces: readonly FurniturePiece[] }) => null),
}));
vi.mock('../../app/office/mounts/DeskKit', () => ({ useDeskKitReady: () => batches.kitReady }));
vi.mock('../../app/office/mounts/StaticGeometry', () => ({
  StaticBoxes: batches.boxes, StaticInstances: batches.screens, UNIT_BOX: {},
}));

const snapshots: { name: string; snapshot: OfficeSnapshot }[] = [
  { name: 'initial empty rooms', snapshot: INITIAL_OFFICE },
  { name: 'preview', snapshot: { ...INITIAL_OFFICE, connection: 'preview', rooms: undefined } },
  { name: 'partial live rooms', snapshot: { ...INITIAL_OFFICE, connection: 'live', rooms: [{ id: 'collections', rowId: 'collections' }] } },
  { name: 'all live rooms', snapshot: { ...INITIAL_OFFICE, connection: 'live', rooms: ANCHOR_IDS.map(id => ({ id, rowId: id })) } },
];

afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe.each([false, true])('shared desk renderer (baked kit ready: %s)', kitReady => {
  it.each(snapshots)('keeps twenty-four visible workstations matching collisions: $name', ({ snapshot }) => {
    batches.kitReady = kitReady;
    vi.stubGlobal('React', React);
    renderToStaticMarkup(React.createElement(Desks, { snapshot }));
    expect(batches.boxes).toHaveBeenCalledOnce();
    expect(batches.screens).toHaveBeenCalledOnce();
    const boxes = batches.boxes.mock.calls[0]![0].pieces;
    const screens = batches.screens.mock.calls[0]![0].pieces;
    const kit = kitReady ? deskKitPlacements(visibleRooms(snapshot)) : [];
    const tops = boxes.filter(piece => piece.size[0] === 2.25 && piece.size[1] === 0.16);
    const seats = boxes.filter(piece => piece.size[0] === 0.65 && piece.size[1] === 0.14);
    const casings = boxes.filter(piece => Math.abs(piece.size[0] - 1.9) < 1e-6);
    const bakedDesks = kit.filter(piece => piece.node === 'desk');
    expect(tops.length + bakedDesks.length).toBe(24);
    expect(seats.length + kit.filter(piece => piece.node === 'chair').length).toBe(24);
    expect(casings.length + kit.filter(piece => piece.node === 'monitor').length).toBe(24);
    expect(screens).toHaveLength(24);

    const centers = [...tops, ...bakedDesks].map(piece => [piece.at[0], piece.at[2]]);
    const colliders = officeColliders(visibleRooms(snapshot));
    for (const { center: [x, z], flip } of WORKSTATIONS) {
      // Checking each seat catches a duplicated desk masking a missing member of a pod.
      expect(centers).toContainEqual([x, z]);
      expect(insideAny([x, z], colliders, 0)).toBe(true);
      expect(insideAny([x + flip * 0.05, z + flip * 0.9], colliders, 0)).toBe(true);
      expect(screens.filter(piece => Math.abs(piece.at[0] - x) < 1 && Math.abs(piece.at[2] - z) < 0.6)).toHaveLength(1);
    }
  });
});
