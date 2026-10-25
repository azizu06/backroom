'use client';

import { useMemo } from 'react';
import { CylinderGeometry, MeshStandardMaterial } from 'three';
import { ROOM_PROP_GROUPS } from '../../../lib/office/room-props';
import { visibleRooms } from '../../../lib/office/state';
import { StaticInstances, UNIT_BOX } from './StaticGeometry';
import type { SceneMountProps } from './types';

const CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 8);
const MATERIAL = new MeshStandardMaterial({ roughness: 0.9 });

export function RoomProps({ snapshot }: SceneMountProps) {
  const roomsKey = visibleRooms(snapshot).slice().sort().join(',');
  const { boxes, cylinders } = useMemo(() => {
    const pieces = ROOM_PROP_GROUPS.filter(({ room }) => room === 'corridor' || room === 'server_room' || roomsKey.split(',').includes(room)).flatMap(item => item.pieces);
    return { boxes: pieces.filter(piece => piece.shape === 'box'), cylinders: pieces.filter(piece => piece.shape === 'cylinder') };
  }, [roomsKey]);
  return <group name='room-props'>
    <StaticInstances pieces={boxes} geometry={UNIT_BOX} material={MATERIAL} castShadow={false} />
    <StaticInstances pieces={cylinders} geometry={CYLINDER} material={MATERIAL} castShadow={false} />
  </group>;
}
