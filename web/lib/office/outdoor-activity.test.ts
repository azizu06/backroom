import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { BoxGeometry, InstancedMesh, MeshBasicMaterial } from 'three';
import { OutdoorActivity } from '../../app/office/mounts/OutdoorActivity';
import { CAR_COUNT, PEOPLE_COUNT, RAIN_COUNT } from './outdoor-activity-motion';

const state = vi.hoisted(() => ({
  camera: { position: { x: 0, z: 0 } }, invalidate: vi.fn(), reduced: false,
  meshes: [] as InstancedMesh[], cleanup: undefined as undefined | (() => void),
}));
vi.mock('@react-three/fiber', () => ({ useThree: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock('../../app/office/mounts/shared', () => ({ useReducedMotion: () => state.reduced }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: () => ({ current: state.meshes }),
  useState: (create: () => unknown) => [create()],
  useLayoutEffect: (effect: () => (() => void)) => { state.cleanup = effect(); },
}));

describe('outdoor activity demand ticker', () => {
  let documentState: EventTarget & { hidden: boolean };
  beforeEach(() => {
    vi.useFakeTimers();
    state.camera.position.x = 0;
    state.camera.position.z = 0;
    state.reduced = false;
    state.invalidate.mockClear();
    state.meshes = [PEOPLE_COUNT, CAR_COUNT, RAIN_COUNT].map(count => new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), count));
    documentState = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', documentState);
    vi.stubGlobal('React', React);
  });
  afterEach(() => {
    state.cleanup?.();
    state.cleanup = undefined;
    expect(vi.getTimerCount()).toBe(0);
    state.meshes.forEach(mesh => { mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose(); });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('pauses transforms and frame requests inside, resumes near a window, then pauses again', () => {
    OutdoorActivity({ overview: false, rain: true });
    const initial = state.meshes.map(mesh => Array.from(mesh.instanceMatrix.array));
    state.invalidate.mockClear();
    vi.advanceTimersByTime(1000);
    expect(state.invalidate).not.toHaveBeenCalled();
    state.meshes.forEach((mesh, i) => expect(Array.from(mesh.instanceMatrix.array)).toEqual(initial[i]));
    state.camera.position.x = -11;
    state.camera.position.z = -6;
    vi.advanceTimersByTime(1000);
    expect(state.invalidate.mock.calls.length).toBeGreaterThanOrEqual(11);
    expect(state.invalidate.mock.calls.length).toBeLessThanOrEqual(13);
    state.meshes.forEach((mesh, i) => expect(Array.from(mesh.instanceMatrix.array)).not.toEqual(initial[i]));
    state.camera.position.x = state.camera.position.z = 0;
    state.invalidate.mockClear();
    vi.advanceTimersByTime(1000);
    expect(state.invalidate).not.toHaveBeenCalled();
  });
  it('freezes people, cars and enabled rain with reduced motion and allocates no timer', () => {
    state.reduced = true;
    OutdoorActivity({ overview: true, rain: true });
    const initial = state.meshes.map(mesh => Array.from(mesh.instanceMatrix.array));
    expect(vi.getTimerCount()).toBe(0);
    state.invalidate.mockClear();
    vi.advanceTimersByTime(5000);
    expect(state.invalidate).not.toHaveBeenCalled();
    state.meshes.forEach((mesh, i) => expect(Array.from(mesh.instanceMatrix.array)).toEqual(initial[i]));
  });
  it('skips rain uploads when disabled and stops all updates in a hidden tab', () => {
    const rainVersion = state.meshes[2]!.instanceMatrix.version;
    OutdoorActivity({ overview: true, rain: false });
    vi.advanceTimersByTime(1000);
    expect(state.meshes[2]!.instanceMatrix.version).toBe(rainVersion);
    documentState.hidden = true;
    documentState.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);
    state.invalidate.mockClear();
    vi.advanceTimersByTime(1000);
    expect(state.invalidate).not.toHaveBeenCalled();
    documentState.hidden = false;
    documentState.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(1000);
    expect(state.invalidate).toHaveBeenCalled();
  });
});
