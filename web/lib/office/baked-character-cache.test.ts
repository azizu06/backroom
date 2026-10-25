import * as React from 'react';
import type { EffectCallback } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AnimationClip, Group, Object3D, PerspectiveCamera, Scene } from 'three';
import { expect, it, vi } from 'vitest';
import { BakedCharacters } from '../../app/office/mounts/BakedCharacters';
import * as seats from './baked-seat';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type OfficeAgent } from './state';

// Drive effects and frames without a browser, WebGL context or GLB request.
const driver = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  scene: null as Scene | null,
  template: null as Group | null,
  clips: [] as AnimationClip[],
  frame: null as ((state: { camera: PerspectiveCamera }, delta: number) => void) | null,
}));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: EffectCallback) => { driver.effects.push(effect); },
}));
vi.mock('@react-three/fiber', () => ({
  useThree: (select: (state: object) => unknown) => select({ scene: driver.scene, invalidate: () => {} }),
  useFrame: (frame: typeof driver.frame) => { driver.frame = frame; },
}));
vi.mock('../../app/office/mounts/shared', () => ({ useReducedMotion: () => false }));
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    async loadAsync() { return { scene: driver.template, animations: driver.clips }; }
  },
}));

it('caches desk seats across frames and refreshes agent node lookups when the agent set changes', async () => {
  driver.scene = new Scene();
  driver.template = new Group();
  for (const side of ['L', 'R']) {
    const thigh = new Object3D(), shin = new Object3D();
    thigh.name = `thigh_${side}`;
    shin.name = `shin_${side}`;
    thigh.add(shin);
    driver.template.add(thigh);
  }
  driver.clips = [new AnimationClip('idle', 1, [])];
  const agents: OfficeAgent[] = [{
    id: 'clerk', name: 'Clerk', seatId: 'collections', targetAnchor: 'collections',
    pos: OFFICE_ANCHORS.collections.position, state: 'idle',
  }];
  const body = new Group();
  body.name = 'agent:clerk';
  body.position.set(-5, 0, -1.8);
  driver.scene.add(body);
  const lookup = vi.spyOn(driver.scene, 'getObjectByName');
  const seat = vi.spyOn(seats, 'deskSeat');
  const cleanups: (() => void)[] = [];
  vi.stubGlobal('window', { location: { search: '?art=baked' } });
  vi.stubGlobal('React', React);
  try {
    renderToStaticMarkup(React.createElement(BakedCharacters, { snapshot: { ...INITIAL_OFFICE, agents } }));
    for (const effect of driver.effects) {
      const cleanup = effect();
      if (cleanup) cleanups.push(cleanup);
    }
    await vi.waitFor(() => expect(seat).toHaveBeenCalledOnce());
    expect(seat).toHaveBeenLastCalledWith('collections');
    expect(lookup).toHaveBeenCalledOnce();
    const camera = new PerspectiveCamera();
    const frames = () => {
      for (let i = 0; i < 60; i++) driver.frame!({ camera }, 1 / 60);
    };
    frames();
    expect(seat).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledOnce();

    // The agent-key effect republishes existing clones when another agent joins.
    const replacement = body.clone();
    driver.scene.remove(body);
    driver.scene.add(replacement);
    const oldUpdates = vi.spyOn(body, 'updateWorldMatrix');
    const newUpdates = vi.spyOn(replacement, 'updateWorldMatrix');
    agents.push({ ...agents[0]!, id: 'new-clerk' });
    driver.effects[1]!();
    expect(seat).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(3);
    frames();
    expect(seat).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(3);
    expect(oldUpdates).not.toHaveBeenCalled();
    expect(newUpdates.mock.calls.length).toBeGreaterThanOrEqual(60);

    // A seat change replaces that clone and computes its new seat once.
    agents[0] = { ...agents[0]!, seatId: 'payables' };
    driver.effects[1]!();
    expect(seat).toHaveBeenCalledTimes(3);
    expect(seat).toHaveBeenLastCalledWith('payables');
    frames();
    expect(seat).toHaveBeenCalledTimes(3);
    expect(lookup).toHaveBeenCalledTimes(5);
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
