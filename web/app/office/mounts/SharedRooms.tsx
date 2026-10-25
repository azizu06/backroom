'use client';

import { CylinderGeometry, MeshStandardMaterial } from 'three';
import { SHARED_ROOM_PIECES } from '../../../lib/office/shared-rooms';
import { StaticInstances, UNIT_BOX } from './StaticGeometry';
import { PALETTE, ROLES } from '../../../lib/office/palette';
import { SharedRoomDisplays } from './SharedRoomDisplays';

// Shared for the lazy scene lifetime, like RoomDetail. Two draws; footprints match SHARED_ROOM_COLLIDERS.
const CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 12);
const MATERIAL = new MeshStandardMaterial({ roughness: 0.85 });
const BOXES = SHARED_ROOM_PIECES.filter(piece => piece.shape === 'box');
const CYLINDERS = SHARED_ROOM_PIECES.filter(piece => piece.shape === 'cylinder');

/** Meeting room, break room and server-room extras. Always shown: these spaces have no live rows. */
export function SharedRooms() {
  return <group name='shared-rooms'>
    <StaticInstances pieces={BOXES} geometry={UNIT_BOX} material={MATERIAL} />
    <StaticInstances pieces={CYLINDERS} geometry={CYLINDER} material={MATERIAL} />
    <SharedRoomDisplays />
    {/* A still steam curl stays visible in reduced motion and the on-demand render loop. */}
    <group name='coffee-steam' position={[6.54, 1.36, 5.6]}>
      {[0, 1, 2].map(i => <mesh key={i} position={[Math.sin(i * 2) * 0.03, i * 0.09, 0]}>
        <icosahedronGeometry args={[0.065 + i * 0.012, 0]} />
        <meshBasicMaterial color={PALETTE.cream} transparent opacity={0.4 - i * 0.08} depthWrite={false} />
      </mesh>)}
    </group>
    <mesh position={[8.6, 2.255, 5.3]}>
      <cylinderGeometry args={[0.24, 0.24, 0.01, 12]} />
      <meshStandardMaterial color={ROLES.lampLight} emissive={ROLES.lampLight} emissiveIntensity={0.7} />
    </mesh>
    <pointLight position={[8.6, 2.15, 5.3]} color={ROLES.lampLight} intensity={1.2} distance={4} decay={2} />
  </group>;
}
