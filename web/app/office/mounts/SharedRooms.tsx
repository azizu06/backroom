'use client';

import { useRef } from 'react';
import { CylinderGeometry, MeshStandardMaterial, type Group } from 'three';
import { SHARED_ROOM_PIECES } from '../../../lib/office/shared-rooms';
import { mergeBoxes, StaticInstances, UNIT_BOX, useDetailLayer } from './StaticGeometry';
import { PROP_MATERIAL, propUnit } from './RoomProps';
import { PALETTE, ROLES } from '../../../lib/office/palette';
import { SharedRoomDisplays } from './SharedRoomDisplays';

// Shared for the lazy scene lifetime, like RoomDetail. Three draws; footprints match SHARED_ROOM_COLLIDERS.
const CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 12);
const MATERIAL = new MeshStandardMaterial({ roughness: 0.85 });
/** Cups, stems, fruit, clock hands and labels: too small to cast a useful shadow, so they skip both shadow passes. */
const small = (piece: (typeof SHARED_ROOM_PIECES)[number]) => Math.max(...piece.size) < 0.3;
const BOXES = SHARED_ROOM_PIECES.filter(piece => piece.shape === 'box' && !small(piece));
const CYLINDERS = SHARED_ROOM_PIECES.filter(piece => piece.shape === 'cylinder' && !small(piece));
const DRESSING = mergeBoxes(SHARED_ROOM_PIECES.filter(small), propUnit);

/** Meeting room, break room and server-room extras. Always shown: these spaces have no live rows. */
export function SharedRooms() {
  const dressing = useRef<Group>(null);
  useDetailLayer(dressing);
  return <group name='shared-rooms'>
    <StaticInstances pieces={BOXES} geometry={UNIT_BOX} material={MATERIAL} />
    <StaticInstances pieces={CYLINDERS} geometry={CYLINDER} material={MATERIAL} />
    <group ref={dressing} name='shared-rooms:dressing'>
      <mesh geometry={DRESSING} material={PROP_MATERIAL} castShadow={false} receiveShadow matrixAutoUpdate={false} dispose={null} />
    </group>
    <SharedRoomDisplays />
    {/* A still steam curl stays visible in reduced motion and the on-demand render loop. */}
    <group name='coffee-steam' position={[6.54, 1.36, 5.6]}>
      {[0, 1, 2].map(i => <mesh key={i} position={[Math.sin(i * 2) * 0.03, i * 0.09, 0]}>
        <icosahedronGeometry args={[0.065 + i * 0.012, 0]} />
        <meshBasicMaterial color={PALETTE.cream} transparent opacity={0.4 - i * 0.08} depthWrite={false} />
      </mesh>)}
    </group>
    {/* Glow only: a point light here would shade every lit pixel of the floor each frame and bypass the
        two-lamp rig and its low-power switch (lib/office/lighting.ts). */}
    <mesh position={[8.6, 2.255, 5.3]}>
      <cylinderGeometry args={[0.24, 0.24, 0.01, 12]} />
      <meshStandardMaterial color={ROLES.lampLight} emissive={ROLES.lampLight} emissiveIntensity={1} />
    </mesh>
  </group>;
}
