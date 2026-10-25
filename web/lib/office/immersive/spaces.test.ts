import { describe, expect, it } from 'vitest';
import { ROOM_ENTER_RADIUS, ROOM_LEAVE_RADIUS } from '../room-entry';
import { FLOOR } from '../play';
import { OFFICE_ANCHORS, type AnchorId } from '../state';
import {
  AMBIENCE_LAYERS, ROOM_SPACES, SPACE_AMBIENCE, WINDOW_BIRDS, WINDOW_Z, ambienceLevel, floorFor, spaceAt, spaceForRoom, windowNearness, type Space,
} from './spaces';

const ROOMS = Object.keys(OFFICE_ANCHORS) as AnchorId[];

describe('space to ambience map', () => {
  it('maps every room to a space and every space to a floor', () => {
    expect(Object.keys(ROOM_SPACES).sort()).toEqual([...ROOMS].sort());
    expect(spaceForRoom('lobby')).toBe('lobby');
    expect(spaceForRoom('collections')).toBe('work');
    expect(spaceForRoom('payables')).toBe('work');
    expect(spaceForRoom('vendor_onboarding')).toBe('work');
    expect(spaceForRoom('dana')).toBe('break');
    expect(spaceForRoom(null)).toBe('aisle');
    expect(floorFor('work')).toBe('carpet');
    expect(floorFor('lobby')).toBe('tile');
    expect(floorFor('break')).toBe('wood');
    expect(floorFor('outdoor')).toBe('grass');
  });
  it('gives each space its signature layer', () => {
    const loudest = (space: Space) => AMBIENCE_LAYERS.reduce((a, b) => SPACE_AMBIENCE[space][a] >= SPACE_AMBIENCE[space][b] ? a : b);
    expect(loudest('lobby')).toBe('hum');
    expect(loudest('break')).toBe('murmur');
    expect(loudest('work')).toBe('keys');
    expect(loudest('outdoor')).toBe('birds');
    for (const space of Object.keys(SPACE_AMBIENCE) as Space[]) for (const layer of AMBIENCE_LAYERS) {
      expect(ambienceLevel(space, layer)).toBeGreaterThanOrEqual(0);
      expect(ambienceLevel(space, layer)).toBeLessThanOrEqual(1);
    }
  });
  it('brings birds in near the windows only', () => {
    expect(windowNearness([0, 0])).toBe(0);
    expect(windowNearness([0, WINDOW_Z])).toBe(1);
    expect(windowNearness([0, WINDOW_Z - 0.8])).toBeCloseTo(0.5);
    expect(windowNearness([FLOOR.maxX + 1, 0])).toBe(1);
    expect(windowNearness([Number.NaN, 0])).toBe(0);
    expect(ambienceLevel('break', 'birds', 1)).toBe(WINDOW_BIRDS);
    expect(ambienceLevel('break', 'birds', 0)).toBe(0);
    expect(ambienceLevel('break', 'murmur', 1)).toBe(SPACE_AMBIENCE.break.murmur);
  });
  it('reads the space at a position with the room-entry hysteresis', () => {
    expect(spaceAt(OFFICE_ANCHORS.lobby.center, null, ROOMS)).toEqual({ room: 'lobby', space: 'lobby' });
    expect(spaceAt(OFFICE_ANCHORS.payables.center, null, ROOMS)).toEqual({ room: 'payables', space: 'work' });
    expect(spaceAt([-2.5, 0.6], null, ROOMS)).toEqual({ room: null, space: 'aisle' });
    // Between the enter and leave radii of the lobby centre: kept while inside, not entered from outside.
    const gap = (ROOM_ENTER_RADIUS + ROOM_LEAVE_RADIUS) / 2;
    const edge = [OFFICE_ANCHORS.lobby.center[0], OFFICE_ANCHORS.lobby.center[1] - gap] as const;
    expect(spaceAt(edge, 'lobby', ROOMS).space).toBe('lobby');
    expect(spaceAt(edge, null, ROOMS).space).toBe('aisle');
    expect(spaceAt([FLOOR.maxX + 2, 0], null, ROOMS)).toEqual({ room: null, space: 'outdoor' });
    expect(spaceAt(OFFICE_ANCHORS.payables.center, null, ['lobby']).space).toBe('aisle');
  });
});
