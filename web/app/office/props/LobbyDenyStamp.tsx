'use client';

import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { visibleRooms } from '../../../lib/office/state';
import { latestDenyRule } from '../../../lib/office/props/lobbyDeny';
import type { SceneMountProps } from '../mounts/types';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';

/**
 * Screen-reader and test hook for the stamp. Created and removed imperatively next to the canvas, never through a
 * drei `Html` portal, whose React-owned container is detached while the view switches and throws on `removeChild`.
 */
function useStampNode(text: string) {
  const host = useThree(state => state.gl.domElement.parentElement);
  useEffect(() => {
    if (!host) return;
    const node = document.createElement('span');
    node.className = 'visually-hidden';
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', text);
    node.dataset.testid = 'lobby-deny-stamp';
    node.textContent = text;
    host.appendChild(node);
    return () => node.remove();
  }, [host, text]);
}

function Stamp({ rule }: { rule: string }) {
  const text = `DENIED · ${rule}`;
  useStampNode(text);
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

/** A persistent decal on the existing lobby audit board, derived only from audit rows. */
export function LobbyDenyStamp({ snapshot }: SceneMountProps) {
  const rule = latestDenyRule(snapshot);
  return visibleRooms(snapshot).includes('lobby') && rule !== null ? <Stamp rule={rule} /> : null;
}
