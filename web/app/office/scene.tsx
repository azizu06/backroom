'use client';

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import { Canvas, invalidate, useFrame, useThree } from '@react-three/fiber';
import { Instances, OrbitControls } from '@react-three/drei';
import { Group, MathUtils, Vector3 } from 'three';
import { cameraAlpha } from '../../lib/office/a11y';
import type { MotionRegistry, WalkMotion } from '../../lib/office/motion';
import type { PlayBridge } from '../../lib/office/play';
import { PlayRig } from './play';
import { OFFICE_ANCHORS, isAnchorId, visibleRooms, type AnchorId, type OfficeAgent, type OfficeSnapshot } from '../../lib/office/state';
import { registerSceneFrameRequester } from '../../lib/office/frame';
import { tourProgress } from '../../lib/office/tour';
import { OFFICE_LIGHTING, officeLightRig } from '../../lib/office/lighting';
import { OfficeLights, OFFICE_RENDERER, useOfficeLowPower } from './OfficeLights';
import { ROLES } from '../../lib/office/palette';
import { bakedCharacterReady, bakedCharacterVersion, subscribeBakedCharacters } from '../../lib/office/baked-character';
import { BEAR_CARRY_PAW, pawPosition } from '../../lib/office/bear';
import { SCENE_MOUNTS } from './mounts';
import { Block, useReducedMotion } from './mounts/shared';
import { PresenceGhosts } from './PresenceGhosts';
import { Bear, createBearRig, poseBear } from './avatars/Bear';
import { CoworkerAvatars } from './CoworkerAvatars';
import type { PresencePeer } from '../../lib/office/presence';
import type { ChatBubble } from '../../lib/office/proximity-chat';

type LabelRef = RefObject<HTMLDivElement | null>;
export type RoomLabels = Record<AnchorId, LabelRef>;
/** Looks up the HTML tag element Office renders for an agent id. */
export type AgentTagLookup = (agentId: string) => HTMLDivElement | undefined;
export const ROOM_IDS = Object.keys(OFFICE_ANCHORS) as AnchorId[];
const { base } = OFFICE_LIGHTING;
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
function Avatar({ agent, motion, tween, recorded, paused }: { agent: OfficeAgent; motion: WalkMotion; tween: boolean; recorded: boolean; paused: boolean }) {
  const reduced = useReducedMotion();
  const body = useRef<Group>(null);
  const [rig] = useState(createBearRig);
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
    poseBear(rig, walk.distance, walk.moving && !tween && !recorded, reduced);
  });
  const bakedVersion = useSyncExternalStore(subscribeBakedCharacters, bakedCharacterVersion, () => 0);
  // The character mount sets this only after that agent's GLB clone exists. Otherwise the bear stays.
  const showGlb = bakedVersion > 0 && bakedCharacterReady(agent.id);
  const color = isAnchorId(agent.seatId) ? OFFICE_ANCHORS[agent.seatId].color : '#9aa38f';
  const folder = agent.escalationId ? <group name={`folder:${agent.escalationId}`}>
    <Block at={[0.05, 0.04, 0.14]} size={[0.1, 0.43, 0.5]} color='#e0b365' />
    <Block at={[0.06, 0.13, 0.14]} size={[0.11, 0.04, 0.34]} color='#f3dfb9' />
  </group> : null;
  // Same paw the bear holds the folder in (bear.ts pawPosition). The GLB has no paw, so the folder sits there on its own.
  const carried = pawPosition(1, BEAR_CARRY_PAW);
  return <group ref={body} name={`agent:${agent.id}`} position={[motion.position[0], 0, motion.position[1]]}>
    {showGlb ? null : <Bear color={color} seed={agent.id} rig={rig} carry={agent.escalationId ? 'paw' : 'none'} paw={folder} />}
    {showGlb && folder && <group position={[carried[0], carried[1], carried[2]]}>{folder}</group>}
  </group>;
}
/** Tour moves start from wherever the camera is when the frame after a focus change renders. */
interface TourMove { startedAt: number | null; position: Vector3; target: Vector3; zoom: number }
function CameraRig({ focus, fixed, tour }: { focus: AnchorId | null; fixed: boolean; tour: boolean }) {
  const reduced = useReducedMotion();
  const { camera, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const moving = useRef(true);
  const orbiting = useRef(false);
  const target = useRef(new Vector3());
  const destination = useRef(new Vector3(13, 15, 17));
  const tourMove = useRef<TourMove>({ startedAt: null, position: new Vector3(), target: new Vector3(), zoom: 1 });
  useEffect(() => {
    const center = focus ? OFFICE_ANCHORS[focus].center : [0, 0];
    target.current.set(center[0]!, 0.2, center[1]!);
    destination.current.copy(target.current).add(new Vector3(13, 15, 17));
    tourMove.current.startedAt = null;
    moving.current = true;
    invalidate();
  }, [focus, size, fixed, tour, invalidate]);
  useFrame((state, delta) => {
    if (orbiting.current) state.invalidate();
    if (!moving.current || !controls.current) return;
    state.invalidate();
    const zoom = focus ? Math.min(size.width / 10, size.height / 8) : Math.min(size.width / 22, size.height / 16);
    if (tour) {
      const move = tourMove.current;
      if (move.startedAt === null) {
        move.startedAt = performance.now();
        move.position.copy(camera.position);
        move.target.copy(controls.current.target);
        move.zoom = camera.zoom;
      }
      const progress = tourProgress(performance.now() - move.startedAt, reduced);
      camera.position.lerpVectors(move.position, destination.current, progress);
      controls.current.target.lerpVectors(move.target, target.current, progress);
      camera.zoom = MathUtils.lerp(move.zoom, zoom, progress);
      camera.updateProjectionMatrix();
      controls.current.update();
      if (progress >= 1) moving.current = false;
      return;
    }
    const alpha = cameraAlpha(delta, reduced);
    camera.position.lerp(destination.current, alpha);
    controls.current.target.lerp(target.current, alpha);
    camera.zoom = MathUtils.lerp(camera.zoom, zoom, alpha);
    camera.updateProjectionMatrix();
    controls.current.update();
    if (camera.position.distanceTo(destination.current) < 0.005 && Math.abs(camera.zoom - zoom) < 0.01) moving.current = false;
  });
  return <OrbitControls ref={controls} onStart={() => { orbiting.current = true; invalidate(); }} onEnd={() => { orbiting.current = false; invalidate(); }} enablePan={false} enableZoom={false} enableRotate={!fixed}
    minPolarAngle={0.45} maxPolarAngle={1.1} minAzimuthAngle={-0.7} maxAzimuthAngle={0.9} />;
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
export function OfficeScene({ snapshot, motions, fixed, tour = false, paused = false, focus, labels, agentTag, onFailure, onRestored, play, presence = [], chatBubbles }: {
  snapshot: OfficeSnapshot; motions: MotionRegistry; fixed: boolean; tour?: boolean; paused?: boolean; focus: AnchorId | null; labels: RoomLabels;
  agentTag?: AgentTagLookup; onFailure: () => void; onRestored: () => void; play?: PlayBridge; presence?: PresencePeer[]; chatBubbles?: ChatBubble[];
}) {
  const lowPower = useOfficeLowPower();
  return <Canvas role='img' aria-label='3D office floor with agent desks. Use the room buttons to inspect badges and limits.' frameloop='demand' shadows={officeLightRig(lowPower).shadows} dpr={[1, 1.5]} orthographic camera={{ position: [13, 15, 17], zoom: 40, near: 0.1, far: 100 }}
    gl={OFFICE_RENDERER} fallback={<span>3D unavailable. Choose the floor plan.</span>}>
    <color attach='background' args={[ROLES.background]} />
    <OfficeLights snapshot={snapshot} lowPower={lowPower} />
    <Instances limit={200} castShadow receiveShadow frustumCulled={false}>
    <boxGeometry args={[1, 1, 1]} /><meshStandardMaterial roughness={base.roughness} />
    {/* Room shell: peach floor, cream walls, lavender partitions, cream room pads and a blush aisle runner. */}
    <Block at={[0, -0.23, 0]} size={[16, 0.45, 11]} color={ROLES.floor} />
    <Block at={[0, 0.55, -5.5]} size={[16, 1.1, 0.16]} color={ROLES.wall} />
    <Block at={[-8, 0.55, 0]} size={[0.16, 1.1, 11]} color={ROLES.wall} />
    <Block at={[0, 0.01, 0.6]} size={[15.8, 0.02, 1.3]} color={ROLES.aisle} />
    {[-2.5, 2.5].map(x => <group key={x}>
      <Block at={[x, 0.38, -3.15]} size={[0.12, 0.76, 4.6]} color={ROLES.partition} />
      <Block at={[x, 0.38, 3.5]} size={[0.12, 0.76, 3.8]} color={ROLES.partition} />
    </group>)}
    {visibleRooms(snapshot).map(room => {
      const { center, color } = OFFICE_ANCHORS[room];
      return <group key={room}>
        <Block at={[center[0], 0.025, center[1]]} size={[4.25, 0.04, room === 'lobby' ? 3.6 : 3.4]} color={focus === room ? color : ROLES.roomPad} />
        <ScreenLabel at={[center[0], 2.5, center[1] - 0.3]} element={labels[room]} />
      </group>;
    })}
    {/* Registered scene pieces (./mounts): instanced ones share these Instances; the rest draw after them. */}
    {SCENE_MOUNTS.filter(mount => mount.instanced).map(({ id, Component }) => <Component key={id} snapshot={snapshot} />)}
    {snapshot.agents.map(agent => <Fragment key={agent.id}>
      <Avatar agent={agent} motion={motions.get(agent)} tween={fixed} recorded={snapshot.connection === 'replay'} paused={paused} />
      {agentTag && <AgentTag agentId={agent.id} motion={motions.get(agent)} element={agentTag} />}
    </Fragment>)}
    </Instances>
    {SCENE_MOUNTS.filter(mount => !mount.instanced).map(({ id, Component }) => <Component key={id} snapshot={snapshot} />)}
    {play ? <CoworkerAvatars peers={presence} bubbles={chatBubbles} /> : <PresenceGhosts peers={presence} />}
    {play ? <PlayRig {...play} motions={motions} snapshot={snapshot} /> : <CameraRig focus={focus} fixed={fixed} tour={tour} />}<ContextLoss onFailure={onFailure} onRestored={onRestored} />
  </Canvas>;
}
