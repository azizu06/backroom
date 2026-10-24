'use client';

import { CylinderGeometry, DodecahedronGeometry, MeshStandardMaterial } from 'three';
import { PLANT_SPOTS, type FurniturePiece } from '../../../lib/office/furniture';
import { StaticInstances } from './StaticGeometry';

const POT = new CylinderGeometry(0.27, 0.18, 0.44, 6);
const LEAVES = new DodecahedronGeometry(0.5, 0);
const MATERIAL = new MeshStandardMaterial();
const POTS: FurniturePiece[] = PLANT_SPOTS.map(([x, z]) => ({ at: [x, 0.22, z], size: [1, 1, 1], color: '#b98667' }));
const TOPS: FurniturePiece[] = PLANT_SPOTS.map(([x, z]) => ({ at: [x, 0.8, z], size: [1, 1, 1], color: '#81936b' }));

/** Fixed plants: two draws and no per-frame matrix work; footprints still match officeColliders. */
export function Plants() {
  return <>
    <StaticInstances pieces={POTS} geometry={POT} material={MATERIAL} receiveShadow={false} />
    <StaticInstances pieces={TOPS} geometry={LEAVES} material={MATERIAL} receiveShadow={false} />
  </>;
}
