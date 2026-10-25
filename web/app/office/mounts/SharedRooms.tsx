'use client';

import { CylinderGeometry, MeshStandardMaterial } from 'three';
import { SHARED_ROOM_PIECES } from '../../../lib/office/shared-rooms';
import { StaticInstances, UNIT_BOX } from './StaticGeometry';

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
  </group>;
}
