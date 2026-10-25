import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { MeshBasicMaterial } from 'three';
import { OutdoorLife } from '../../app/office/mounts/OutdoorLife';

const state = vi.hoisted(() => ({
  camera: { position: { x: 0, z: 0 } }, invalidate: vi.fn(), reduced: false,
  cleanup: undefined as undefined | (() => void),
}));
vi.mock('@react-three/fiber', () => ({ useThree: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock('../../app/office/mounts/shared', () => ({ useReducedMotion: () => state.reduced }));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (current: unknown) => ({ current }),
  useState: (create: () => unknown) => [create()],
  useLayoutEffect: (effect: () => (() => void)) => { state.cleanup = effect(); },
}));

// Exercise the actual component's effect with hook adapters; no WebGL renderer is needed for its ticker.
describe('outdoor demand ticker', () => {
  let documentState: EventTarget & { hidden: boolean };
  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  function mount(overview = false) {
    return OutdoorLife({ plants: [], overview, skyMaterial: new MeshBasicMaterial(), sunMaterial: new MeshBasicMaterial() });
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
