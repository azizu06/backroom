'use client';

import { visibleRooms } from '../../../lib/office/state';
import { latestDenyRule } from '../../../lib/office/props/lobbyDeny';
import type { SceneMountProps } from '../mounts/types';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';
import { useSceneTextNode } from './useSceneTextNode';
import { LOBBY_BOARD } from '../../../lib/office/layout';

const [BOARD_X, BOARD_Z] = LOBBY_BOARD;

function Stamp({ rule }: { rule: string }) {
  const text = `DENIED · ${rule}`;
  useSceneTextNode('lobby-deny-stamp', text);
  const texture = useCanvasTexture(768, 192, ctx => {
    ctx.strokeStyle = ctx.fillStyle = '#ed6252';
    ctx.lineWidth = 9;
    ctx.strokeRect(10, 10, 748, 172);
    ctx.lineWidth = 3;
    ctx.strokeRect(22, 22, 724, 148);
    ctx.font = `800 56px ${PROP_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 384, 99, 696);
  }, [text]);
  return <group name='prop:lobby-deny-stamp' position={[BOARD_X, 1.25, BOARD_Z + 0.11]} rotation={[0, 0, -0.09]}>
    <mesh>
      <planeGeometry args={[1.75, 0.44]} /><meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  </group>;
}

/** A persistent decal on the existing lobby audit board, derived only from audit rows. */
export function LobbyDenyStamp({ snapshot }: SceneMountProps) {
  const rule = latestDenyRule(snapshot);
  return visibleRooms(snapshot).includes('lobby') && rule !== null ? <Stamp rule={rule} /> : null;
}
