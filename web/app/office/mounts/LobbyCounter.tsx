'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { visibleRooms } from '../../../lib/office/state';
import { bakedReplacesAuditBoard } from '../../../lib/office/baked-art';
import { useBakedLobbyReady } from './BakedArt';
import { Block } from './shared';
import { LOBBY_BOARD_MOUNT } from '../../../lib/office/layout';
import { PAYLINK_KIOSK } from '../../../lib/office/targets/paylink';
import type { SceneMountProps } from './types';
import { PALETTE, ROLES } from '../../../lib/office/palette';

/**
 * Lobby audit board (last three decisions) and the east-wall inbox counter / Play payment link kiosk.
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
  const { x, y, z, width, height, depth } = LOBBY_BOARD_MOUNT;
  return <><group position={[x, 0, z]}>
    {board && <Block at={[0, y, 0]} size={[width, height, depth]} color={ROLES.frame} />}
    {board && snapshot.audit.slice(-3).map((row, i) => <Block key={row.id} at={[0, 1.65 - i * 0.35, depth / 2 + 0.003]} size={[1.55, 0.09, 0.006]} color={row.decision === 'DENY' ? ROLES.deny : PALETTE.mint} />)}
  </group>
  <Block at={[PAYLINK_KIOSK[0], 0.34, PAYLINK_KIOSK[1]]} size={[0.65, 0.68, 0.8]} color={ROLES.partition} />
  <Block at={[PAYLINK_KIOSK[0], 0.72, PAYLINK_KIOSK[1]]} size={[0.8, 0.12, 1]} color={ROLES.desk} />
  </>;
}
