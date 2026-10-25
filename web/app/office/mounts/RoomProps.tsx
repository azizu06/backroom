'use client';

import { useRef } from 'react';
import { CylinderGeometry, MeshStandardMaterial, type BufferGeometry, type Group } from 'three';
import { ROOM_PROP_GROUPS, roomPropsVisible } from '../../../lib/office/room-props';
import type { DetailPiece } from '../../../lib/office/props/roomDetail';
import { visibleRooms } from '../../../lib/office/state';
import { mergeBoxes, UNIT_BOX, useDetailLayer } from './StaticGeometry';
import type { SceneMountProps } from './types';

// Shared for the lazy scene's app lifetime, like RoomDetail; meshes opt out of auto-disposal.
export const PROP_CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 8);
export const PROP_MATERIAL = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
export const propUnit = (piece: DetailPiece) => piece.shape === 'cylinder' ? PROP_CYLINDER : UNIT_BOX;
/**
 * One merged, vertex-coloured mesh per room vignette, baked once on first show. Each room is one draw with
 * its own bounds, so the camera culls vignettes outside a room focus view. No useFrame subscription.
 */
const GEOMETRIES = new Map<number, BufferGeometry>();
function vignetteGeometry(index: number): BufferGeometry {
  let geometry = GEOMETRIES.get(index);
  if (!geometry) GEOMETRIES.set(index, geometry = mergeBoxes(ROOM_PROP_GROUPS[index]!.pieces, propUnit));
  return geometry;
}

export function RoomProps({ snapshot }: SceneMountProps) {
  const rooms = visibleRooms(snapshot);
  const root = useRef<Group>(null);
  useDetailLayer(root, rooms.join(','));
  return <group ref={root} name='room-props'>
    {ROOM_PROP_GROUPS.map((group, index) => roomPropsVisible(group.room, rooms) &&
      <mesh key={group.room} geometry={vignetteGeometry(index)} material={PROP_MATERIAL} castShadow={false} receiveShadow
        matrixAutoUpdate={false} dispose={null} />)}
  </group>;
}
