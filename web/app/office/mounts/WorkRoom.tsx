'use client';

import { MeshLambertMaterial } from 'three';
import { WORK_ROOM_PIECES } from '../../../lib/office/wing';
import { StaticInstances, UNIT_BOX } from './StaticGeometry';

const MATERIAL = new MeshLambertMaterial();
/** Eight workstations, chairs, lamps and printer in one static instanced draw. */
export function WorkRoom() {
  return <group name='work-room'>
    <StaticInstances pieces={WORK_ROOM_PIECES} geometry={UNIT_BOX} material={MATERIAL} castShadow={false} />
  </group>;
}
