'use client';

import { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { VoiceIcon } from './VoiceIcon';
import { useSyncExternalStore } from 'react';
import { screenStore } from '../../lib/office/screens';
import type { VoiceLevel } from '../../lib/office/voice';
import { MathUtils, type Group } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { REDUCED_MOTION_QUERY } from '../../lib/office/a11y';
import { ghostPeers, type PresencePeer } from '../../lib/office/presence';

function Ghost({ peer, level = 0 }: { peer: PresencePeer; level?: VoiceLevel }) {
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
    <Html position={[0, 1.72, 0]} center distanceFactor={12} style={{ color: '#d0d6c6', background: '#272f25dd', border: '1px solid #8b987b', borderRadius: 3, padding: '2px 5px', fontSize: 11, whiteSpace: 'nowrap', pointerEvents: 'none' }}><VoiceIcon level={level} />{peer.name}</Html>
  </group>;
}
export function PresenceGhosts({ peers, speaking = {} }: { peers: PresencePeer[]; speaking?: Record<string, VoiceLevel> }) {
  const screens = useSyncExternalStore(screenStore.subscribe, screenStore.getSnapshot, screenStore.getServerSnapshot);
  return <>{ghostPeers(peers).filter(peer => !screens.seats.some(seat => seat.viewerId === peer.viewerId)).map(peer => <Ghost key={peer.viewerId} peer={peer} level={speaking[peer.viewerId]} />)}</>; }
