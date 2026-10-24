'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, BoxGeometry, CylinderGeometry, DoubleSide, IcosahedronGeometry, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  type Group, type Mesh, type Side, type Texture,
} from 'three';
import { REDUCED_MOTION_QUERY } from '../../../lib/office/a11y';
import { OFFICE_ANCHORS, visibleRooms, type OfficeSnapshot } from '../../../lib/office/state';
import {
  AMBIENT_FPS, GLOW_MEAN, ambientActive, ambientDesks, busyLevel, cursorBlink, plantSway, screenGlow, type AmbientDesk,
} from '../../../lib/office/props/ambient';
import { useCanvasTexture } from './useCanvasTexture';

/** Peak additive opacity of a busy desk's screen glow, and of the lobby board rim. */
const GLOW_BASE = 0.2, BOARD_GLOW_BASE = 0.14, BOARD_SEED = 4;
const GLOW_TEX = 64;
/** Desk-local monitor face centre (see scene.tsx Desk) and the desk-top plant spot. */
const SCREEN: [number, number, number] = [-0.35, 1.18, -0.165];
const CURSOR: [number, number, number] = [-0.62, 1.07, -0.1705];
const PLANT: [number, number, number] = [0.85, 0.91, -0.3];
const LOBBY_BOARD: [number, number, number] = [-5.9, 1.25, 3.78];

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => false);
}
function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
function useDocumentHidden() {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'hidden', () => false);
}

function createShared() {
  return {
    screenGlow: new PlaneGeometry(0.67 + 0.16, 0.37 + 0.14),
    boardGlow: new PlaneGeometry(2.9, 2.2),
    cursor: new BoxGeometry(0.014, 0.045, 0.003),
    cursorMaterial: new MeshStandardMaterial({ color: '#f1ede2', emissive: '#f1ede2', emissiveIntensity: 0.8 }),
    pot: new CylinderGeometry(0.05, 0.038, 0.08, 10),
    potMaterial: new MeshStandardMaterial({ color: '#b98667', roughness: 0.9 }),
    leaf: new IcosahedronGeometry(1, 0),
    leafMaterial: new MeshStandardMaterial({ color: '#81936b', roughness: 0.9, flatShading: true }),
  };
}
type Shared = ReturnType<typeof createShared>;

/** Soft white rectangle on transparent: the glow quad's falloff. */
function drawGlow(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 12;
  ctx.fillRect(14, 14, GLOW_TEX - 28, GLOW_TEX - 28);
}

function useGlowMaterial(color: string, map: Texture, opacity: number, side?: Side) {
  const [material] = useState(() => new MeshBasicMaterial({
    color, map, opacity, side, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
  }));
  useEffect(() => () => material.dispose(), [material]);
  return material;
}

function DeskPlant({ shared, foliage }: { shared: Shared; foliage: RefObject<Group | null> }) {
  return <group position={PLANT}>
    <mesh geometry={shared.pot} material={shared.potMaterial} position={[0, 0.04, 0]} castShadow receiveShadow />
    <group ref={foliage} position={[0, 0.08, 0]}>
      <mesh geometry={shared.leaf} material={shared.leafMaterial} position={[0, 0.06, 0]} scale={[0.065, 0.075, 0.065]} castShadow />
      <mesh geometry={shared.leaf} material={shared.leafMaterial} position={[0.03, 0.11, 0.01]} scale={0.04} castShadow />
      <mesh geometry={shared.leaf} material={shared.leafMaterial} position={[-0.03, 0.1, -0.02]} scale={0.035} castShadow />
    </group>
  </group>;
}

function DeskAmbient({ room, seed, busy, active, shared, glowMap }: {
  room: AmbientDesk; seed: number; busy: number; active: boolean; shared: Shared; glowMap: Texture;
}) {
  const [x, z] = OFFICE_ANCHORS[room].center;
  const level = 0.4 + 0.6 * busy;
  const material = useGlowMaterial(OFFICE_ANCHORS[room].color, glowMap, GLOW_BASE * GLOW_MEAN * level);
  const cursor = useRef<Mesh>(null);
  const foliage = useRef<Group>(null);
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => { invalidate(); }, [level, invalidate]);
  // Reads the frame clock only; frames come from the shared ticker or the rest of the scene.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    material.opacity = GLOW_BASE * (active ? screenGlow(t, seed) : GLOW_MEAN) * level;
    if (cursor.current) cursor.current.visible = !active || cursorBlink(t);
    if (foliage.current) {
      foliage.current.rotation.z = active ? plantSway(t, seed) : 0;
      foliage.current.rotation.x = active ? plantSway(t, seed + 5) * 0.6 : 0;
    }
  });
  return <group position={[x, 0, z]} rotation={[0, room === 'dana' ? Math.PI : 0, 0]}>
    <mesh geometry={shared.screenGlow} material={material} position={SCREEN} renderOrder={1} />
    {busy >= 1 && <mesh ref={cursor} geometry={shared.cursor} material={shared.cursorMaterial} position={CURSOR} />}
    {room !== 'dana' && <DeskPlant shared={shared} foliage={foliage} />}
  </group>;
}

/** A faint rim of light around the lobby audit board, visible from both sides. */
function BoardGlow({ active, shared, glowMap }: { active: boolean; shared: Shared; glowMap: Texture }) {
  const material = useGlowMaterial(OFFICE_ANCHORS.collections.color, glowMap, BOARD_GLOW_BASE * GLOW_MEAN, DoubleSide);
  useFrame(({ clock }) => {
    material.opacity = BOARD_GLOW_BASE * (active ? screenGlow(clock.elapsedTime, BOARD_SEED) : GLOW_MEAN);
  });
  return <mesh geometry={shared.boardGlow} material={material} position={LOBBY_BOARD} renderOrder={1} />;
}

/**
 * View-only ambience: breathing screen glow, blinking cursors on busy screens and swaying desk plants.
 * One low-rate ticker requests frames while active; reduced motion, a hidden tab or replay get one static frame.
 */
export function Ambient({ snapshot }: { snapshot: OfficeSnapshot }) {
  const invalidate = useThree(state => state.invalidate);
  const reduced = useReducedMotion();
  const hidden = useDocumentHidden();
  const active = ambientActive(snapshot, reduced, hidden);
  const [shared] = useState(createShared);
  useEffect(() => () => { for (const resource of Object.values(shared)) resource.dispose(); }, [shared]);
  const glowMap = useCanvasTexture(GLOW_TEX, GLOW_TEX, drawGlow, []);
  useEffect(() => {
    invalidate();
    if (!active) return;
    const timer = setInterval(() => invalidate(), 1000 / AMBIENT_FPS);
    return () => clearInterval(timer);
  }, [active, invalidate]);
  return <group name='prop:ambient'>
    {ambientDesks(snapshot).map(({ room, seed }) => <DeskAmbient key={room} room={room} seed={seed} busy={busyLevel(snapshot, room)}
      active={active} shared={shared} glowMap={glowMap} />)}
    {visibleRooms(snapshot).includes('lobby') && <BoardGlow active={active} shared={shared} glowMap={glowMap} />}
  </group>;
}
