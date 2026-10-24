'use client';

import { useThree } from '@react-three/fiber';
import { visibleRooms } from '../../../lib/office/state';
import { bakedReplacesAuditBoard } from '../../../lib/office/baked-art';
import { useBakedArtRequested } from '../mounts/BakedArt';
import { latestDenyRule } from '../../../lib/office/props/lobbyDeny';
import type { SceneMountProps } from '../mounts/types';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';
import { useSceneTextNode } from './useSceneTextNode';

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
  return <group name='prop:lobby-deny-stamp' position={[-5.9, 1.25, 3.98]} rotation={[0, 0, -0.09]}>
    <mesh>
      <planeGeometry args={[1.75, 0.44]} /><meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  </group>;
}

/** A persistent decal on the existing lobby audit board, derived only from audit rows; hidden with the board under ?art=baked in first person. */
export function LobbyDenyStamp({ snapshot }: SceneMountProps) {
  const baked = useBakedArtRequested();
  const overview = useThree(state => (state.camera as { isOrthographicCamera?: boolean }).isOrthographicCamera === true);
  const rule = latestDenyRule(snapshot);
  return visibleRooms(snapshot).includes('lobby') && rule !== null && !bakedReplacesAuditBoard(baked, overview) ? <Stamp rule={rule} /> : null;
}
