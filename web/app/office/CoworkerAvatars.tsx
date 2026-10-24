'use client';

import { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { MathUtils, type Group } from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { legSwing } from '../../lib/office/a11y';
import { ghostPeers, type PresencePeer } from '../../lib/office/presence';
import type { ChatBubble } from '../../lib/office/proximity-chat';
import { useReducedMotion } from './mounts/shared';

const SKIN = '#d6a782', TROUSERS = '#3e4740', HAIR = '#3a3029';
const TAG = { color: '#d0d6c6', background: '#272f25dd', border: '1px solid #8b987b', borderRadius: 3, padding: '2px 5px', fontSize: 11, whiteSpace: 'nowrap', pointerEvents: 'none' } as const;

function Part({ at, size, color }: { at: [number, number, number]; size: [number, number, number]; color: string }) {
  return <mesh position={at} castShadow><boxGeometry args={size} /><meshStandardMaterial color={color} flatShading roughness={0.85} /></mesh>;
}

/** Another viewer walking in Play: a low-poly person (bears are the AI agents) that eases toward its published pose. */
function Coworker({ peer, bubble }: { peer: PresencePeer; bubble?: ChatBubble }) {
  const root = useRef<Group>(null);
  const legs = useRef<Group>(null);
  const walked = useRef(0);
  // Initial pose only: a changing position prop would snap the group and skip the lerp.
  const [start] = useState(() => [peer.x, 0, peer.z] as const);
  const [startYaw] = useState(peer.yaw);
  const invalidate = useThree(state => state.invalidate);
  const reduced = useReducedMotion();
  // A new pose or bubble needs one frame to start easing or place the tag; useFrame keeps going only while moving.
  useEffect(() => { invalidate(); }, [peer.x, peer.z, peer.yaw, bubble?.id, reduced, invalidate]);
  useFrame((_, dt) => {
    const group = root.current;
    if (!group) return;
    const alpha = reduced ? 1 : 1 - Math.exp(-9 * Math.min(dt, 0.1));
    const fromX = group.position.x, fromZ = group.position.z;
    group.position.x = MathUtils.lerp(fromX, peer.x, alpha);
    group.position.z = MathUtils.lerp(fromZ, peer.z, alpha);
    const yawDelta = Math.atan2(Math.sin(peer.yaw - group.rotation.y), Math.cos(peer.yaw - group.rotation.y));
    group.rotation.y += yawDelta * alpha;
    const step = Math.hypot(group.position.x - fromX, group.position.z - fromZ);
    walked.current += step;
    const error = Math.hypot(group.position.x - peer.x, group.position.z - peer.z);
    const moving = error > 0.01 || Math.abs(yawDelta) > 0.01;
    if (legs.current) legs.current.children.forEach((leg, i) => { leg.rotation.x = legSwing(walked.current, i, moving && step > 1e-4, reduced); });
    if (moving) invalidate();
  });
  // Front faces -z at yaw 0, like the first-person camera the pose comes from.
  return <group ref={root} position={start} rotation={[0, startYaw, 0]} name={`coworker:${peer.viewerId}`}>
    <group ref={legs}>{[-1, 1].map(side => <group key={side} position={[side * 0.11, 0.62, 0]}>
      <Part at={[0, -0.31, 0]} size={[0.16, 0.62, 0.2]} color={TROUSERS} />
    </group>)}</group>
    <Part at={[0, 0.96, 0]} size={[0.44, 0.62, 0.26]} color={peer.color} />
    {[-1, 1].map(side => <Part key={side} at={[side * 0.29, 0.97, 0]} size={[0.12, 0.56, 0.16]} color={peer.color} />)}
    <mesh position={[0, 1.46, 0]} castShadow><icosahedronGeometry args={[0.19, 0]} /><meshStandardMaterial color={SKIN} flatShading roughness={0.8} /></mesh>
    <Part at={[0, 1.6, 0.03]} size={[0.34, 0.1, 0.32]} color={HAIR} />
    {[-1, 1].map(side => <Part key={side} at={[side * 0.07, 1.49, -0.17]} size={[0.04, 0.04, 0.02]} color='#202620' />)}
    <Html position={[0, 1.9, 0]} center distanceFactor={12} zIndexRange={[5, 4]} style={{ ...TAG, borderColor: peer.color }}>{peer.name}</Html>
    {bubble && <Html position={[0, 2.25, 0]} center distanceFactor={10} zIndexRange={[5, 4]}>
      <div className='coworker-bubble' data-viewer-id={peer.viewerId}>{bubble.text}</div>
    </Html>}
  </group>;
}

/** Play replaces the translucent presence ghosts with people; each carries its latest chat bubble. */
export function CoworkerAvatars({ peers, bubbles = [] }: { peers: PresencePeer[]; bubbles?: ChatBubble[] }) {
  return <>{ghostPeers(peers).map(peer => <Coworker key={peer.viewerId} peer={peer} bubble={bubbles.find(bubble => bubble.viewerId === peer.viewerId)} />)}</>;
}
