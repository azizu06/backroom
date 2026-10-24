'use client';

import { Fragment, useEffect, useRef, type RefObject } from 'react';
import { Canvas, invalidate, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Instances } from '@react-three/drei';
import { Group, MathUtils, Vector3 } from 'three';
import { legSwing } from '../../lib/office/a11y';
import type { MotionRegistry, WalkMotion } from '../../lib/office/motion';
import type { PlayBridge, PlayGuide } from '../../lib/office/play';
import { PlayRig } from './play';
import { OFFICE_ANCHORS, isAnchorId, visibleRooms, type AnchorId, type OfficeAgent, type OfficeSnapshot } from '../../lib/office/state';
import { registerSceneFrameRequester } from '../../lib/office/frame';
import { OFFICE_LIGHTING } from '../../lib/office/lighting';
import { SCENE_MOUNTS } from './mounts';
import { Block, useReducedMotion } from './mounts/shared';
import { CoworkerAvatars } from './CoworkerAvatars';
import type { PresencePeer } from '../../lib/office/presence';
import type { ChatBubble } from '../../lib/office/proximity-chat';

type LabelRef = RefObject<HTMLDivElement | null>;
export type RoomLabels = Record<AnchorId, LabelRef>;
/** Looks up the HTML tag element Office renders for an agent id. */
export type AgentTagLookup = (agentId: string) => HTMLDivElement | undefined;
export const ROOM_IDS = Object.keys(OFFICE_ANCHORS) as AnchorId[];
const { key: keyLight, fill: fillLight, hemisphere, contactShadows, base } = OFFICE_LIGHTING;
// Office (in the initial bundle) requests on-demand frames through this bridge.
registerSceneFrameRequester(invalidate);

function ScreenLabel({ at, element }: { at: [number, number, number]; element: LabelRef }) {
  const point = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    point.current.set(...at).project(camera);
    if (!element.current) return;
    element.current.style.visibility = point.current.z > 1 || Math.abs(point.current.x) > 1.05 || Math.abs(point.current.y) > 1.05 ? 'hidden' : 'visible';
    element.current.style.transform = `translate(${(point.current.x + 1) * size.width / 2}px, ${(1 - point.current.y) * size.height / 2}px) translate(-50%, -50%)`;
  });
  return null;
}
/** Projects the avatar's current head position onto its HTML tag on frames that are already rendering. */
function AgentTag({ agentId, motion, element }: { agentId: string; motion: WalkMotion; element: AgentTagLookup }) {
  const point = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    const tag = element(agentId);
    if (!tag) return;
    point.current.set(motion.position[0], 1.95, motion.position[1]).project(camera);
    const offscreen = Math.abs(point.current.x) > 1.05 || Math.abs(point.current.y) > 1.05 || point.current.z > 1;
    tag.style.visibility = offscreen ? 'hidden' : 'visible';
    tag.style.transform = `translate(${(point.current.x + 1) * size.width / 2}px, ${(1 - point.current.y) * size.height / 2}px) translate(-50%, -100%)`;
  });
  return null;
}
/** Draws the shared motion; Office's MotionRegistry owns re-seating, retargeting and the wake-up frame. */
function Avatar({ agent, motion, recorded, paused }: { agent: OfficeAgent; motion: WalkMotion; recorded: boolean; paused: boolean }) {
  const reduced = useReducedMotion();
  const body = useRef<Group>(null);
  const legs = useRef<Group>(null);
  useFrame((state, delta) => {
    const walk = motion;
    if (paused) return;
    if (recorded) walk.seat(agent.pos);
    else walk.advance(delta);
    if (walk.moving) state.invalidate();
    if (!body.current) return;
    body.current.position.set(walk.position[0], 0, walk.position[1]);
    const turn = MathUtils.euclideanModulo(walk.heading - body.current.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
    body.current.rotation.y += turn * (1 - Math.exp(-12 * Math.min(delta, 0.1)));
    if (legs.current) legs.current.children.forEach((leg, i) => { leg.rotation.x = legSwing(walk.distance, i, walk.moving && !recorded, reduced); });
  });
  const color = isAnchorId(agent.seatId) ? OFFICE_ANCHORS[agent.seatId].color : '#9aa38f';
  return <group ref={body} position={[motion.position[0], 0, motion.position[1]]}>
    <Block at={[0, 0.83, 0]} size={[0.43, 0.6, 0.28]} color={color} />
    <Block at={[0, 1.3, 0]} size={[0.34, 0.36, 0.32]} color='#c58d67' />
    <Block at={[0, 1.49, -0.02]} size={[0.36, 0.1, 0.35]} color='#3c342e' />
    {[-1, 1].map(side => <Block key={side} at={[side * 0.3, 0.84, 0]} size={[0.14, 0.48, 0.18]} color={color} />)}
    {agent.escalationId && <group name={`folder:${agent.escalationId}`}>
      <Block at={[0.36, 0.68, 0.14]} size={[0.1, 0.43, 0.5]} color='#e0b365' />
      <Block at={[0.37, 0.77, 0.14]} size={[0.11, 0.04, 0.34]} color='#f3dfb9' />
    </group>}
    <group ref={legs}>{[-1, 1].map(side => <mesh key={side} position={[side * 0.12, 0.3, 0]} castShadow>
      <boxGeometry args={[0.18, 0.55, 0.22]} /><meshStandardMaterial color='#414b43' />
    </mesh>)}</group>
  </group>;
}
function ContextLoss({ onFailure, onRestored }: { onFailure: () => void; onRestored: () => void }) {
  const gl = useThree(state => state.gl);
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    const canvas = gl.domElement;
    const restored = () => { onRestored(); invalidate(); };
    canvas.addEventListener('webglcontextlost', onFailure);
    canvas.addEventListener('webglcontextrestored', restored);
    return () => {
      canvas.removeEventListener('webglcontextlost', onFailure);
      canvas.removeEventListener('webglcontextrestored', restored);
    };
  }, [gl, invalidate, onFailure, onRestored]);
  return null;
}
/**
 * Renders on demand: frames are requested only while agents walk, doors flash or the camera moves.
 * `paused` stops avatars advancing the shared motions while another view (the floor plan) drives them.
 */
export function OfficeScene({ snapshot, motions, paused = false, focus, guide = null, labels, agentTag, onFailure, onRestored, play, presence = [], chatBubbles }: {
  snapshot: OfficeSnapshot; motions: MotionRegistry; paused?: boolean; focus: AnchorId | null; guide?: PlayGuide | null; labels: RoomLabels;
  agentTag?: AgentTagLookup; onFailure: () => void; onRestored: () => void; play: PlayBridge; presence?: PresencePeer[]; chatBubbles?: ChatBubble[];
}) {
  // The orthographic default camera is only the Play intro's starting pose; PlayRig's first-person camera takes over.
  return <Canvas role='img' aria-label='3D office floor with agent desks. Use the room buttons to inspect badges and limits.' frameloop='demand' shadows dpr={[1, 1.5]} orthographic camera={{ position: [13, 15, 17], zoom: 40, near: 0.1, far: 100 }}
    gl={{ antialias: true, powerPreference: 'high-performance' }} fallback={<span>3D unavailable. The text view below the office lists every seat and receipt.</span>}>
    <color attach='background' args={['#202620']} />
    <hemisphereLight args={[hemisphere.skyColor, hemisphere.groundColor, hemisphere.intensity]} />
    <directionalLight position={keyLight.position} color={keyLight.color} intensity={keyLight.intensity} castShadow={keyLight.castShadow}
      shadow-mapSize={[keyLight.shadow.mapSize, keyLight.shadow.mapSize]} shadow-bias={keyLight.shadow.bias}
      shadow-camera-near={keyLight.shadow.near} shadow-camera-far={keyLight.shadow.far}
      shadow-camera-left={keyLight.shadow.left} shadow-camera-right={keyLight.shadow.right} shadow-camera-top={keyLight.shadow.top} shadow-camera-bottom={keyLight.shadow.bottom} />
    <directionalLight position={fillLight.position} color={fillLight.color} intensity={fillLight.intensity} castShadow={fillLight.castShadow} />
    {/* frames={Infinity} (default) re-bakes on every frame, but with frameloop='demand' that is only frames
        something else requested (walking agents, door flashes, camera moves), so avatars stay grounded while
        they walk and the scene never loops on its own. Each such frame also pays a second shadow-map pass.
        Scale and color are module constants so drei's render targets are not reallocated on re-render.
        Bases exactly at y=0 (desk legs, walls) sit below the plane and get no blob; raised undersides
        (desktops, torsos, feet) do. */}
    <ContactShadows position={contactShadows.position} near={contactShadows.near} scale={contactShadows.scale} resolution={contactShadows.resolution}
      blur={contactShadows.blur} opacity={contactShadows.opacity} far={contactShadows.far} color={contactShadows.color} />
    <Instances limit={200} castShadow receiveShadow frustumCulled={false}>
    <boxGeometry args={[1, 1, 1]} /><meshStandardMaterial roughness={base.roughness} />
    <Block at={[0, -0.23, 0]} size={[16, 0.45, 11]} color='#535c4e' />
    <Block at={[0, 0.55, -5.5]} size={[16, 1.1, 0.16]} color='#828976' />
    <Block at={[-8, 0.55, 0]} size={[0.16, 1.1, 11]} color='#747e6a' />
    <Block at={[0, 0.01, 0.6]} size={[15.8, 0.02, 1.3]} color='#687361' />
    {[-2.5, 2.5].map(x => <group key={x}>
      <Block at={[x, 0.38, -3.15]} size={[0.12, 0.76, 4.6]} color='#828976' />
      <Block at={[x, 0.38, 3.5]} size={[0.12, 0.76, 3.8]} color='#828976' />
    </group>)}
    {visibleRooms(snapshot).map(room => {
      const { center, color } = OFFICE_ANCHORS[room];
      return <group key={room}>
        <Block at={[center[0], 0.025, center[1]]} size={[4.25, 0.04, room === 'lobby' ? 3.6 : 3.4]} color={focus === room ? color : '#626e5b'} />
        <ScreenLabel at={[center[0], 2.5, center[1] - 0.3]} element={labels[room]} />
      </group>;
    })}
    {/* Registered scene pieces (./mounts): instanced ones share these Instances; the rest draw after them. */}
    {SCENE_MOUNTS.filter(mount => mount.instanced).map(({ id, Component }) => <Component key={id} snapshot={snapshot} />)}
    {snapshot.agents.map(agent => <Fragment key={agent.id}>
      <Avatar agent={agent} motion={motions.get(agent)} recorded={snapshot.connection === 'replay'} paused={paused} />
      {agentTag && <AgentTag agentId={agent.id} motion={motions.get(agent)} element={agentTag} />}
    </Fragment>)}
    </Instances>
    {SCENE_MOUNTS.filter(mount => !mount.instanced).map(({ id, Component }) => <Component key={id} snapshot={snapshot} />)}
    <CoworkerAvatars peers={presence} bubbles={chatBubbles} />
    <PlayRig {...play} motions={motions} snapshot={snapshot} guide={guide} /><ContextLoss onFailure={onFailure} onRestored={onRestored} />
  </Canvas>;
}
