import { describe, expect, it } from 'vitest';
import { FLOOR, PLAYER_RADIUS, SERVER_ROOM_BOX, SPAWN, interactCandidates, officeColliders, pickTarget, playPanel, targetKey, targetLabel } from './play';
import { playSpawn } from './play-spawn';
import { INITIAL_OFFICE } from './state';
import { coworkerSpots } from './targets/coworker';
import type { PresencePeer } from './presence';

const peer = (overrides: Partial<PresencePeer> = {}): PresencePeer => ({ viewerId: 'v1', name: 'Viewer 00V1', color: '#a9bc8f', x: -5, z: -0.2, yaw: 0, mode: 'play', at: 1, ...overrides });

describe('coworker play targets', () => {
  it('only viewers in Play become targets', () => {
    expect(coworkerSpots([peer(), peer({ viewerId: 'v2', mode: 'overview' })])).toEqual([{ id: 'v1', name: 'Viewer 00V1', position: [-5, -0.2] }]);
  });
  it('walking up to a coworker offers Say hi with a prefilled greeting', () => {
    const candidates = interactCandidates([], [], [], coworkerSpots([peer()]));
    const target = pickTarget([-5, 0.9], 0, candidates);
    expect(target).toEqual({ kind: 'coworker', id: 'v1', name: 'Viewer 00V1' });
    expect(targetKey(target)).toBe('coworker:v1');
    expect(targetLabel(INITIAL_OFFICE, target!)).toBe('Say hi to Viewer 00V1');
    expect(playPanel(INITIAL_OFFICE, target!)).toMatchObject({ kind: 'coworker', greeting: 'Hi Viewer 00V1!' });
    expect(pickTarget([-5, 4], 0, candidates)).toBeNull();
  });
  it('agents win exact ties with coworkers', () => {
    const candidates = interactCandidates([{ id: 'alex', position: [-5, -0.2] }], [], [], coworkerSpots([peer()]));
    expect(pickTarget([-5, 0.9], 0, candidates)).toMatchObject({ kind: 'agent' });
  });
});

describe('test-only play spawn', () => {
  const colliders = officeColliders(['lobby', 'collections', 'payables', 'vendor_onboarding', 'treasury'], [SERVER_ROOM_BOX]);
  it('reads ?playSpawn=x,z and clamps it to the floor', () => {
    expect(playSpawn('?playSpawn=5,0.6', colliders)).toEqual([5, 0.6]);
    expect(playSpawn('?playSpawn=-99,0.6', colliders)).toEqual([FLOOR.minX + PLAYER_RADIUS, 0.6]);
  });
  it('falls back to the lobby spawn when missing, malformed or inside a collider', () => {
    const spawn = [SPAWN.position[0], SPAWN.position[1]];
    expect(playSpawn('', colliders)).toEqual(spawn);
    expect(playSpawn('?playSpawn=1', colliders)).toEqual(spawn);
    expect(playSpawn('?playSpawn=NaN,1', colliders)).toEqual(spawn);
    expect(playSpawn('?playSpawn=,1', colliders)).toEqual(spawn);
    expect(playSpawn('?playSpawn=7.1,-0.8', colliders)).toEqual(spawn);
  });
});
