'use client';

import { Html } from '@react-three/drei';
import { visibleRooms } from '../../../lib/office/state';
import { latestDenyRule } from '../../../lib/office/props/lobbyDeny';
import type { SceneMountProps } from '../mounts/types';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';

function Stamp({ rule }: { rule: string }) {
  const text = `DENIED · ${rule}`;
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
  return <group name='prop:lobby-deny-stamp' position={[-5.9, 1.25, 3.98]} rotation={[0, 0, -0.09]}>
    <mesh>
      <planeGeometry args={[1.75, 0.44]} /><meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
    <Html center style={{ pointerEvents: 'none' }}>
      <span className='visually-hidden' role='img' aria-label={text} data-testid='lobby-deny-stamp'>{text}</span>
    </Html>
  </group>;
}

/** A persistent decal on the existing lobby audit board, derived only from audit rows. */
export function LobbyDenyStamp({ snapshot }: SceneMountProps) {
  const rule = latestDenyRule(snapshot);
  return visibleRooms(snapshot).includes('lobby') && rule !== null ? <Stamp rule={rule} /> : null;
}
