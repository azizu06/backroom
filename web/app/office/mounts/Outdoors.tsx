'use client';

import { useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { usePrecompile } from './usePrecompile';
import {
  AdditiveBlending, BackSide, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, Float32BufferAttribute,
  IcosahedronGeometry, MeshBasicMaterial, MeshLambertMaterial, SphereGeometry, type Group,
} from 'three';
import type { FurniturePiece } from '../../../lib/office/furniture';
import { BUSHES, GRASS_RADIUS, HILLS, PATH, PLAZA, SUN_DIRECTION, SUN_DISTANCE, TREES } from '../../../lib/office/outdoors';
import { OUTDOOR, ROLES } from '../../../lib/office/palette';
import { StaticBoxes, StaticInstances } from './StaticGeometry';

// Shared for the lazy scene's lifetime (dispose={null} on every user). Instance colours tint the white materials.
const SKY_RADIUS = 450;
const SKY = (() => {
  const geometry = new SphereGeometry(SKY_RADIUS, 32, 16);
  const top = new Color(OUTDOOR.skyTop), horizon = new Color(OUTDOOR.skyHorizon), color = new Color();
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const height = Math.max(0, position.getY(i) / SKY_RADIUS);
    color.copy(horizon).lerp(top, Math.pow(height, 0.55)).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
})();
const SKY_MATERIAL = new MeshBasicMaterial({ vertexColors: true, side: BackSide, depthWrite: false, fog: false, toneMapped: false });
const SUN_DISC = new CircleGeometry(9, 32);
const SUN_HALO = new CircleGeometry(26, 32);
const SUN_MATERIAL = new MeshBasicMaterial({ color: OUTDOOR.sun, fog: false, toneMapped: false });
const HALO_MATERIAL = new MeshBasicMaterial({ color: OUTDOOR.sunHalo, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false, fog: false, toneMapped: false });
const GRASS = new CircleGeometry(GRASS_RADIUS, 48);
// Lambert, unshadowed: the grounds fill most of the screen, so they stay cheap to shade (software WebGL included).
const GRASS_MATERIAL = new MeshLambertMaterial({ color: OUTDOOR.grass });
const GROUND_MATERIAL = new MeshLambertMaterial({ vertexColors: true });
const PLANT_MATERIAL = new MeshLambertMaterial({ flatShading: true });
const HILL_MATERIAL = new MeshLambertMaterial({ flatShading: true });
/** Outdoor meshes live on their own layer so the floor's contact-shadow pass (layer 0 only) skips them; Outdoors enables it on the active camera. */
export const OUTDOOR_LAYER = 2;
const TRUNK = new CylinderGeometry(0.5, 0.7, 1, 6);
const PINE = new ConeGeometry(1, 1, 7);
const ROUND = new IcosahedronGeometry(1, 0);
const BUSH = new DodecahedronGeometry(0.5, 0);
const HILL = new SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2);

const GROUND: FurniturePiece[] = [
  { at: [(PATH.minX + PATH.maxX) / 2, 0.006, (PATH.minZ + PATH.maxZ) / 2], size: [PATH.maxX - PATH.minX, 0.02, PATH.maxZ - PATH.minZ], color: OUTDOOR.path },
  { at: [(PLAZA.minX + PLAZA.maxX) / 2, 0.008, (PLAZA.minZ + PLAZA.maxZ) / 2], size: [PLAZA.maxX - PLAZA.minX, 0.02, PLAZA.maxZ - PLAZA.minZ], color: OUTDOOR.path },
  // The street the path starts from, with a kerb either side.
  { at: [0, 0.004, PATH.maxZ + 3.5], size: [GRASS_RADIUS * 1.6, 0.02, 6], color: ROLES.shadow },
  ...[-1, 1].map((side): FurniturePiece => ({ at: [0, 0.05, PATH.maxZ + 3.5 + side * 3.1], size: [GRASS_RADIUS * 1.6, 0.1, 0.2], color: OUTDOOR.path })),
];
const TRUNKS: FurniturePiece[] = TREES.map(tree => {
  const height = tree.height * (tree.kind === 'pine' ? 0.3 : 0.45);
  return { at: [tree.x, height / 2, tree.z], size: [tree.radius * 0.3, height, tree.radius * 0.3], color: OUTDOOR.trunk };
});
const PINES: FurniturePiece[] = TREES.filter(tree => tree.kind === 'pine').map(tree => {
  const base = tree.height * 0.22, cone = tree.height - base;
  return { at: [tree.x, base + cone / 2, tree.z], size: [tree.radius, cone, tree.radius], color: tree.tint ? OUTDOOR.foliage : OUTDOOR.foliageLight };
});
const ROUNDS: FurniturePiece[] = TREES.filter(tree => tree.kind === 'round').map(tree => ({
  at: [tree.x, tree.height - tree.radius * 0.8, tree.z], size: [tree.radius, tree.radius * 0.9, tree.radius],
  rotation: [0, tree.x * 1.7, 0], color: tree.tint ? OUTDOOR.foliageLight : OUTDOOR.foliage,
}));
const BUSH_PIECES: FurniturePiece[] = BUSHES.map(bush => ({ at: [bush.x, bush.size * 0.32, bush.z], size: [bush.size * 1.3, bush.size, bush.size * 1.3],
  rotation: [0, bush.z * 2.3, 0], color: bush.tint ? OUTDOOR.bush : OUTDOOR.grassDark }));
const HILL_PIECES: FurniturePiece[] = HILLS.map(hill => ({ at: [hill.x, -0.5, hill.z], size: [hill.width, hill.height, hill.width * 0.6],
  rotation: [0, Math.atan2(hill.x, hill.z), 0], color: hill.far ? OUTDOOR.hillsFar : OUTDOOR.hills }));
const SUN_AT: [number, number, number] = [SUN_DIRECTION[0] * SUN_DISTANCE, SUN_DIRECTION[1] * SUN_DISTANCE, SUN_DIRECTION[2] * SUN_DISTANCE];

/**
 * The grounds: grass, the entrance path and street, instanced low-poly trees and bushes (one draw per
 * shape), and, in first person only, a gradient sky, the sun disc on the key light's direction and a ring
 * of distant hills. Static batches; nothing animates or requests frames.
 */
export function Outdoors() {
  const overview = useThree(state => (state.camera as { isOrthographicCamera?: boolean }).isOrthographicCamera === true);
  const sky = useRef<Group>(null);
  const root = useRef<Group>(null);
  const camera = useThree(state => state.camera);
  usePrecompile(sky);
  useLayoutEffect(() => {
    root.current?.traverse(node => node.layers.set(OUTDOOR_LAYER));
    camera.layers.enable(OUTDOOR_LAYER);
  }, [camera]);
  return <group ref={root} name='outdoors'>
    <mesh geometry={GRASS} material={GRASS_MATERIAL} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} dispose={null} />
    <StaticBoxes pieces={GROUND} material={GROUND_MATERIAL} castShadow={false} receiveShadow={false} />
    <StaticInstances pieces={TRUNKS} geometry={TRUNK} material={PLANT_MATERIAL} castShadow={false} receiveShadow={false} />
    <StaticInstances pieces={PINES} geometry={PINE} material={PLANT_MATERIAL} castShadow={false} receiveShadow={false} />
    <StaticInstances pieces={ROUNDS} geometry={ROUND} material={PLANT_MATERIAL} castShadow={false} receiveShadow={false} />
    <StaticInstances pieces={BUSH_PIECES} geometry={BUSH} material={PLANT_MATERIAL} castShadow={false} receiveShadow={false} />
    <group ref={sky} visible={!overview} name='outdoors:sky'>
      <mesh geometry={SKY} material={SKY_MATERIAL} renderOrder={-10} frustumCulled={false} dispose={null} />
      <StaticInstances pieces={HILL_PIECES} geometry={HILL} material={HILL_MATERIAL} castShadow={false} receiveShadow={false} />
      <group position={SUN_AT} onUpdate={group => group.lookAt(0, 0, 0)}>
        <mesh geometry={SUN_HALO} material={HALO_MATERIAL} renderOrder={-9} dispose={null} />
        <mesh geometry={SUN_DISC} material={SUN_MATERIAL} renderOrder={-8} position={[0, 0, 0.5]} dispose={null} />
      </group>
    </group>
  </group>;
}
