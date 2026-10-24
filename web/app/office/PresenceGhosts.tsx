'use client';

import { useEffect, useRef, useState } from 'react';
import { PROP_FONT, useCanvasTexture } from './props/useCanvasTexture';
import { MathUtils, type Group } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { REDUCED_MOTION_QUERY } from '../../lib/office/a11y';
import { ghostPeers, type PresencePeer } from '../../lib/office/presence';

function Ghost({ peer }: { peer: PresencePeer }) {
  const root = useRef<Group>(null);
  // Initial pose only: a changing position prop would snap the group and skip the lerp.
  const [start] = useState(() => [peer.x, 0, peer.z] as const);
  const invalidate = useThree(state => state.invalidate);
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED_MOTION_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useFrame((_, dt) => {
    if (!root.current) return;
    const target = [peer.x, 0, peer.z] as const;
    const alpha = reduced ? 1 : 1 - Math.exp(-9 * Math.min(dt, 0.1));
    root.current.position.x = MathUtils.lerp(root.current.position.x, target[0], alpha);
    root.current.position.z = MathUtils.lerp(root.current.position.z, target[2], alpha);
    const yawDelta = Math.atan2(Math.sin(peer.yaw - root.current.rotation.y), Math.cos(peer.yaw - root.current.rotation.y));
    root.current.rotation.y += yawDelta * alpha;
    const positionError = Math.hypot(root.current.position.x - target[0], root.current.position.z - target[2]);
    if (positionError > 0.01 || Math.abs(yawDelta) > 0.01) invalidate();
  });
  return <group ref={root} position={start}>
    <mesh position={[0, 0.78, 0]}><capsuleGeometry args={[0.22, 0.72, 3, 6]} /><meshBasicMaterial color={peer.color} transparent opacity={0.48} depthWrite={false} /></mesh>
    <mesh position={[0, 1.38, 0]}><coneGeometry args={[0.16, 0.28, 5]} /><meshBasicMaterial color={peer.color} transparent opacity={0.65} depthWrite={false} /></mesh>
    <NameTag name={peer.name} />
  </group>;
}
const TAG_W = 256, TAG_H = 48;
/**
 * The viewer's name above the ghost, drawn into a sprite texture. Not drei's <Html>: ghosts mount and expire
 * while the viewer walks in Play, and unmounting an <Html> label there threw a removeChild error.
 */
function NameTag({ name }: { name: string }) {
  const texture = useCanvasTexture(TAG_W, TAG_H, ctx => {
    ctx.clearRect(0, 0, TAG_W, TAG_H);
    ctx.font = `600 26px ${PROP_FONT}`;
    const width = Math.min(TAG_W - 4, ctx.measureText(name).width + 20);
    ctx.fillStyle = '#272f25dd';
    ctx.fillRect((TAG_W - width) / 2, 4, width, TAG_H - 8);
    ctx.strokeStyle = '#8b987b';
    ctx.lineWidth = 2;
    ctx.strokeRect((TAG_W - width) / 2, 4, width, TAG_H - 8);
    ctx.fillStyle = '#d0d6c6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, TAG_W / 2, TAG_H / 2 + 1, TAG_W - 24);
  }, [name]);
  return <sprite position={[0, 1.72, 0]} scale={[0.8, 0.15, 1]}><spriteMaterial map={texture} transparent depthWrite={false} /></sprite>;
}
export function PresenceGhosts({ peers }: { peers: PresencePeer[] }) { return <>{ghostPeers(peers).map(peer => <Ghost key={peer.viewerId} peer={peer} />)}</>; }
