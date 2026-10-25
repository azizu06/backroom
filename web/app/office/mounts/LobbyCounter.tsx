'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { visibleRooms } from '../../../lib/office/state';
import { bakedReplacesAuditBoard } from '../../../lib/office/baked-art';
import { useBakedLobbyReady } from './BakedArt';
import { Block } from './shared';
import { LOBBY_BOARD } from '../../../lib/office/layout';
import { PAYLINK_KIOSK } from '../../../lib/office/targets/paylink';
import type { SceneMountProps } from './types';
import { PALETTE, ROLES } from '../../../lib/office/palette';

/**
 * Lobby decision board (last three decisions) and, by the east wall, the inbox counter, which is also the Play payment link kiosk (PAYLINK_KIOSK).
 * Under ?art=baked in first person the board hides (bakedReplacesAuditBoard); the counter always stays.
 */
export function LobbyCounter({ snapshot }: SceneMountProps) {
  const baked = useBakedLobbyReady();
  const overview = useThree(state => (state.camera as { isOrthographicCamera?: boolean }).isOrthographicCamera === true);
  const host = useThree(state => state.gl.domElement.parentElement);
  const lobby = visibleRooms(snapshot).includes('lobby');
  const board = !bakedReplacesAuditBoard(baked, overview);
  // Test hook: whether the procedural audit board is drawn (`shown`) or replaced by the loaded baked lobby (`baked`).
  useEffect(() => {
    if (!host || !lobby) return;
    host.dataset.lobbyAuditBoard = board ? 'shown' : 'baked';
    return () => { delete host.dataset.lobbyAuditBoard; };
  }, [host, lobby, board]);
  if (!lobby) return null;
  const [x, z] = LOBBY_BOARD;
  return <>{board && <group position={[x, 0, z]}>
    <Block at={[0, 1.25, 0]} size={[2, 1.45, 0.15]} color={ROLES.frame} />
    {snapshot.audit.slice(-3).map((row, i) => <Block key={row.id} at={[0, 1.65 - i * 0.35, 0.09]} size={[1.55, 0.09, 0.04]} color={row.decision === 'DENY' ? ROLES.deny : PALETTE.mint} />)}
  </group>}
  <Block at={[PAYLINK_KIOSK[0], 0.72, PAYLINK_KIOSK[1]]} size={[0.8, 0.12, 1]} color={ROLES.desk} />
  </>;
}
