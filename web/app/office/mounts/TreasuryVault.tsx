'use client';

import { visibleRooms } from '../../../lib/office/state';
import { OFFICE_LIGHTING } from '../../../lib/office/lighting';
import { Block } from './shared';
import type { SceneMountProps } from './types';
import { PALETTE, ROLES } from '../../../lib/office/palette';

const { vault } = OFFICE_LIGHTING;

export function TreasuryVault({ snapshot }: SceneMountProps) {
  if (!visibleRooms(snapshot).includes('treasury')) return null;
  return <group>
    <Block at={[5, 0.7, 4]} size={[1.8, 1.4, 1.25]} color={ROLES.frame} />
    <mesh position={[5, 0.7, 3.35]} castShadow receiveShadow>
      <boxGeometry args={[1.4, 1.05, 0.08]} />
      <meshStandardMaterial color={vault.color} roughness={vault.roughness} metalness={vault.metalness} />
    </mesh>
    <Block at={[5, 0.7, 3.28]} size={[0.12, 0.48, 0.1]} color={PALETTE.butter} />
  </group>;
}
