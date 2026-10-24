'use client';

import { useMemo } from 'react';
import { CylinderGeometry, MeshStandardMaterial } from 'three';
import { visibleRooms, type AnchorId } from '../../../lib/office/state';
import { roomDetailsInRooms } from '../../../lib/office/props/roomDetail';
import { StaticInstances, UNIT_BOX } from './StaticGeometry';
import type { SceneMountProps } from './types';

// Shared for the lazy scene lifetime, like Plants. Two draws; no per-frame work or extra lights.
const CYLINDER = new CylinderGeometry(0.5, 0.5, 1, 8);
const MATERIAL = new MeshStandardMaterial({ roughness: 0.9 });

export function RoomDetail({ snapshot }: SceneMountProps) {
  const roomsKey = visibleRooms(snapshot).slice().sort().join(',');
  const { boxes, cylinders } = useMemo(() => {
    const pieces = roomDetailsInRooms(roomsKey.split(',') as AnchorId[]).flatMap(detail => detail.pieces);
    return { boxes: pieces.filter(piece => piece.shape === 'box'), cylinders: pieces.filter(piece => piece.shape === 'cylinder') };
  }, [roomsKey]);
  return <group name='room-detail'>
    {boxes.length > 0 && <StaticInstances pieces={boxes} geometry={UNIT_BOX} material={MATERIAL} castShadow={false} />}
    {cylinders.length > 0 && <StaticInstances pieces={cylinders} geometry={CYLINDER} material={MATERIAL} castShadow={false} />}
  </group>;
}
