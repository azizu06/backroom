import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeskKitDesks } from '../../app/office/mounts/DeskKit';
import { setDeskKitReady, workstationKitPlacements } from './deskkit';
import { WORKSTATIONS } from './layout';
import { INITIAL_OFFICE } from './state';
import { DESKS } from './targets/desk';
import { deskScreenPiece, EXTRA_WORKSTATIONS, type FurniturePiece } from './furniture';
import { MONITOR_FACE } from './props/monitors';
import { ROLES } from './palette';

const batches = vi.hoisted(() => ({
  fallback: vi.fn(() => null),
  screens: vi.fn((_props: { pieces: readonly FurniturePiece[] }) => null),
}));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof React>(),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => boolean) => getSnapshot(),
}));
vi.mock('../../app/office/mounts/Desks', () => ({ Desks: batches.fallback }));
vi.mock('../../app/office/mounts/StaticGeometry', () => ({ StaticInstances: batches.screens, UNIT_BOX: {} }));

afterEach(() => { setDeskKitReady(false); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('registered kit desk renderer', () => {
  it('retains the original procedural renderer until the kit is ready', () => {
    vi.stubGlobal('React', React);
    renderToStaticMarkup(React.createElement(DeskKitDesks, { snapshot: INITIAL_OFFICE }));
    expect(batches.fallback).toHaveBeenCalledOnce();
    expect(batches.screens).not.toHaveBeenCalled();
  });

  it('replaces every pod box after loading, preserving all procedural screen transforms', () => {
    vi.stubGlobal('React', React);
    setDeskKitReady(true);
    renderToStaticMarkup(React.createElement(DeskKitDesks, { snapshot: INITIAL_OFFICE }));
    expect(batches.fallback).not.toHaveBeenCalled();
    const screens = batches.screens.mock.calls[0]![0].pieces;
    const originalScreens = [...DESKS.map(deskScreenPiece), ...EXTRA_WORKSTATIONS.map(({ center: [x, z], flip }) => ({
      at: [x + flip * MONITOR_FACE.x, MONITOR_FACE.y, z + flip * (MONITOR_FACE.z + 0.05)],
      size: [MONITOR_FACE.width, MONITOR_FACE.height, 0.015], color: ROLES.screenGlow,
      rotation: [0, flip === -1 ? Math.PI : 0, 0],
    }))];
    expect(screens).toHaveLength(WORKSTATIONS.length);
    expect(screens).toEqual(expect.arrayContaining(originalScreens));
    expect(workstationKitPlacements().filter(piece => piece.node === 'desk')).toHaveLength(screens.length);
  });
});
