'use client';

import { visibleRooms } from '../../../lib/office/state';
import { OFFICE_LIGHTING } from '../../../lib/office/lighting';
import { Block } from './shared';
import type { SceneMountProps } from './types';
import { PALETTE, ROLES } from '../../../lib/office/palette';
import { TREASURY_VAULT, deskKitReplaces } from '../../../lib/office/deskkit';
import { useDeskKitReady } from './DeskKit';

const { vault } = OFFICE_LIGHTING;

export function TreasuryVault({ snapshot }: SceneMountProps) {
  const kit = useDeskKitReady();
  // Under ?art=baked with the desk kit loaded, the kit's vault body and door stand here instead.
  if (!visibleRooms(snapshot).includes('treasury') || deskKitReplaces(kit, 'treasury')) return null;
  const { x, z, width, height, depth } = TREASURY_VAULT;
  return <group>
    <Block at={[x, height / 2, z]} size={[width, height, depth]} color={ROLES.frame} />
    <mesh position={[x, 0.7, z - 0.65]} castShadow receiveShadow>
      <boxGeometry args={[1.4, 1.05, 0.08]} />
      <meshStandardMaterial color={vault.color} roughness={vault.roughness} metalness={vault.metalness} />
    </mesh>
    <Block at={[x, 0.7, z - 0.72]} size={[0.12, 0.48, 0.1]} color={PALETTE.butter} />
  </group>;
}
