'use client';

import { visibleRooms } from '../../../lib/office/state';
import { Block } from './shared';
import type { SceneMountProps } from './types';
import { PALETTE, ROLES } from '../../../lib/office/palette';

/** Lobby audit wall (last three decisions) and the inbox counter, which is also the Play payment link kiosk (PAYLINK_KIOSK). */
export function LobbyCounter({ snapshot }: SceneMountProps) {
  if (!visibleRooms(snapshot).includes('lobby')) return null;
  return <group position={[-5.9, 0, 3.9]}>
    <Block at={[0, 1.25, 0]} size={[2, 1.45, 0.15]} color={ROLES.frame} />
    {snapshot.audit.slice(-3).map((row, i) => <Block key={row.id} at={[0, 1.65 - i * 0.35, -0.09]} size={[1.55, 0.09, 0.04]} color={row.decision === 'DENY' ? ROLES.deny : PALETTE.mint} />)}
    <Block at={[1.5, 0.72, -0.8]} size={[0.8, 0.12, 1]} color={ROLES.desk} />
    {Array.from({ length: Math.min(snapshot.inboxCount, 3) }, (_, i) => <Block key={i} at={[1.5, 0.84 + i * 0.09, -0.8]} size={[0.5, 0.06, 0.65]} color={ROLES.wall} rotation={i * 0.06} />)}
  </group>;
}
