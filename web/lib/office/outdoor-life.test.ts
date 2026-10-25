import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { BoxGeometry, InstancedMesh, MeshBasicMaterial } from 'three';
import { BIRD_COUNT, CLOUD_COUNT, birdPosition, cloudPosition, daylightBlend } from './outdoor-motion';
import { OUTDOOR } from './palette';
import { OutdoorActivity } from '../../app/office/mounts/OutdoorActivity';
import { OutdoorLife } from '../../app/office/mounts/OutdoorLife';

const state = vi.hoisted(() => ({
  camera: { position: { x: 0, z: 0 } }, invalidate: vi.fn(), reduced: false,
  refs: [] as { current: unknown }[], refIndex: 0,
  clouds: undefined as InstancedMesh | undefined, birds: undefined as InstancedMesh | undefined,
  cleanup: undefined as undefined | (() => void),
}));
vi.mock('@react-three/fiber', () => ({ useThree: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock('../../app/office/mounts/shared', () => ({ useReducedMotion: () => state.reduced }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (current: unknown) => {
    const index = state.refIndex++;
    return state.refs[index] ??= { current: index === 2 ? state.clouds : index === 3 ? state.birds : current };
  },
  useState: (create: () => unknown) => [create()],
  useLayoutEffect: (effect: () => (() => void)) => { state.cleanup = effect(); },
}));

// Exercise the actual component's effect with hook adapters; no WebGL renderer is needed for its ticker.
describe('outdoor demand ticker', () => {
  let documentState: EventTarget & { hidden: boolean };
  beforeEach(() => {
    vi.useFakeTimers();
    state.refs = [];
    state.refIndex = 0;
    state.clouds = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), CLOUD_COUNT * 3);
    state.birds = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), BIRD_COUNT);
    state.camera.position.x = 0;
    state.camera.position.z = 0;
    state.reduced = false;
    state.invalidate.mockClear();
    documentState = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', documentState);
    // The repository's Vitest transform uses classic JSX; Next uses automatic JSX.
    vi.stubGlobal('React', React);
  });
  afterEach(() => {
    state.cleanup?.();
    state.cleanup = undefined;
    expect(vi.getTimerCount()).toBe(0);
    for (const mesh of [state.clouds!, state.birds!]) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const skyMaterial = new MeshBasicMaterial(), sunMaterial = new MeshBasicMaterial(), haloMaterial = new MeshBasicMaterial();
  function mount(overview = false, rain = false) {
    state.refIndex = 0;
    return OutdoorLife({ plants: [], overview, skyMaterial, sunMaterial, haloMaterial, rain });
  }
  it('stays idle inside, wakes near a window and stops requesting frames when leaving it', () => {
    mount();
    state.invalidate.mockClear();
    vi.advanceTimersByTime(1000);
    expect(state.invalidate).not.toHaveBeenCalled();
    state.camera.position.x = -11;
    state.camera.position.z = -6;
    vi.advanceTimersByTime(1000);
    expect(state.invalidate.mock.calls.length).toBeGreaterThanOrEqual(11);
    expect(state.invalidate.mock.calls.length).toBeLessThanOrEqual(13);
    state.camera.position.x = 0;
    state.camera.position.z = 0;
    state.invalidate.mockClear();
    vi.advanceTimersByTime(1000);
    expect(state.invalidate).not.toHaveBeenCalled();
  });
  it('continues clouds, birds and daylight through an overview switch', () => {
    state.camera.position.x = -11;
    state.camera.position.z = -6;
    mount();
    vi.advanceTimersByTime(10000);
    const cloudBefore = Array.from(state.clouds!.instanceMatrix.array);
    const birdBefore = Array.from(state.birds!.instanceMatrix.array);
    const sunBefore = sunMaterial.color.clone();
    const elapsed = state.refs[0]!.current as number;
    state.cleanup?.();
    mount(true);
    expect(Array.from(state.clouds!.instanceMatrix.array)).toEqual(cloudBefore);
    expect(Array.from(state.birds!.instanceMatrix.array)).toEqual(birdBefore);
    expect(sunMaterial.color).toEqual(sunBefore);
    vi.advanceTimersByTime(1000);
    const continued = state.refs[0]!.current as number;
    expect(continued).toBeGreaterThan(elapsed);
    expect(state.clouds!.instanceMatrix.array[12]).toBeCloseTo(cloudPosition(continued, 0, 'x') - 5, 4);
    expect(state.birds!.instanceMatrix.array[12]).toBeCloseTo(birdPosition(continued, 0, 'x'), 4);
    expect(sunMaterial.color.clone().set(OUTDOOR.sun).lerp(sunMaterial.color.clone().set(OUTDOOR.sunWarm), daylightBlend(continued))).toEqual(sunMaterial.color);
  });
  it('dims both the sun disc and halo during rain, including with reduced motion', () => {
    state.reduced = true;
    mount(true);
    const disc = sunMaterial.color.clone(), halo = haloMaterial.color.clone();
    state.cleanup?.();
    mount(true, true);
    expect(sunMaterial.color.getHexString()).toBe(OUTDOOR.rainSun.slice(1).toLowerCase());
    expect(haloMaterial.color.getHexString()).toBe(OUTDOOR.rainSunHalo.slice(1).toLowerCase());
    expect(sunMaterial.color.r + sunMaterial.color.g + sunMaterial.color.b).toBeLessThan(disc.r + disc.g + disc.b);
    expect(haloMaterial.color.r + haloMaterial.color.g + haloMaterial.color.b).toBeLessThan(halo.r + halo.g + halo.b);
    state.cleanup?.();
    mount(true);
    expect(sunMaterial.color).toEqual(disc);
    expect(haloMaterial.color).toEqual(halo);
  });
  it('shares one 12 fps timer and one invalidation between life and activity', () => {
    mount(true);
    const cleanupLife = state.cleanup;
    state.refs = [];
    state.refIndex = 0;
    OutdoorActivity({ overview: true, rain: true });
    const cleanupActivity = state.cleanup;
    state.cleanup = () => { cleanupLife?.(); cleanupActivity?.(); };
    expect(vi.getTimerCount()).toBe(1);
    state.invalidate.mockClear();
    vi.advanceTimersByTime(1000);
    expect(state.invalidate.mock.calls.length).toBeGreaterThanOrEqual(11);
    expect(state.invalidate.mock.calls.length).toBeLessThanOrEqual(13);
    cleanupActivity?.();
    expect(vi.getTimerCount()).toBe(1);
    state.invalidate.mockClear();
    vi.advanceTimersByTime(1000);
    expect(state.invalidate).toHaveBeenCalled();
  });
  it('uses no timer with reduced motion, even in overview', () => {
    state.reduced = true;
    mount(true);
    expect(vi.getTimerCount()).toBe(0);
    state.invalidate.mockClear();
    vi.advanceTimersByTime(5000);
    expect(state.invalidate).not.toHaveBeenCalled();
  });
  it('stops its overview timer in a hidden tab and restarts on visibility', () => {
    mount(true);
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
