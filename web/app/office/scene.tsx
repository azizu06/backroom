'use client';

import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import { Canvas, invalidate, useFrame, useThree } from '@react-three/fiber';
import { Instances, OrbitControls } from '@react-three/drei';
import { Group, MathUtils, MeshStandardMaterial, Vector3, type Camera } from 'three';
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
import { BUILDING, CORRIDOR, CORRIDOR_Z, SPACES, SPACE_IDS, roomPad, sightBlocked, type SpaceId } from '../../lib/office/layout';
import { bakedCharacterReady, bakedCharacterVersion, subscribeBakedCharacters } from '../../lib/office/baked-character';
import { BEAR_CARRY_PAW, pawPosition } from '../../lib/office/bear';
import { SCENE_MOUNTS } from './mounts';
import { Block, useReducedMotion } from './mounts/shared';
import { PresenceGhosts } from './PresenceGhosts';
import { ContactDynamic } from './ContactShadows';
import { UNIT_BOX } from './mounts/StaticGeometry';
import { Bear, createBearRig, poseBear } from './avatars/Bear';
import { useAgentAnimator } from './avatars/agentAnimator';
import { agentCueKey, deskHeading } from '../../lib/office/agent-motion';
import { CoworkerAvatars } from './CoworkerAvatars';
import type { PresencePeer } from '../../lib/office/presence';
import type { ChatBubble } from '../../lib/office/proximity-chat';
import { CLICK_SLOP, roomRect, type OverviewPick } from '../../lib/office/overview';
import type { ThreeEvent } from '@react-three/fiber';

/** Overview click handler: what was picked and where (client coordinates). */
export type OverviewPickHandler = (pick: OverviewPick, at: { x: number; y: number }) => void;
/** Pointer cursor over pickable things in Overview; a drag (orbit) is not a pick. */
function pickHandlers(pick: OverviewPick, onPick: OverviewPickHandler) {
  return {
    onClick(event: ThreeEvent<MouseEvent>) {
      event.stopPropagation();
      if (event.delta > CLICK_SLOP) return;
      onPick(pick, { x: event.nativeEvent.clientX, y: event.nativeEvent.clientY });
    },
    onPointerOver(event: ThreeEvent<PointerEvent>) { event.stopPropagation(); document.body.style.cursor = 'pointer'; },
    onPointerOut() { document.body.style.cursor = ''; },
  };
}
/** Invisible pads over each room floor: clicking a room in Overview jumps into it in first person. */
function RoomPicks({ rooms, onPick }: { rooms: readonly AnchorId[]; onPick: OverviewPickHandler }) {
  useEffect(() => () => { document.body.style.cursor = ''; }, []);
  return <>{rooms.map(room => {
    const { center } = OFFICE_ANCHORS[room];
    return <mesh key={room} name={`room-pick:${room}`} position={[center[0], 0.06, center[1]]} rotation-x={-Math.PI / 2} {...pickHandlers({ kind: 'room', room }, onPick)}>
      <planeGeometry args={[4.25, room === 'lobby' ? 3.6 : 3.4]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>;
  })}</>;
}

type LabelRef = RefObject<HTMLDivElement | null>;
export type RoomLabels = Record<AnchorId, LabelRef>;
/** Looks up the HTML tag element Office renders for an agent id. */
export type AgentTagLookup = (agentId: string) => HTMLDivElement | undefined;
export const ROOM_IDS = Object.keys(OFFICE_ANCHORS) as AnchorId[];
const { base } = OFFICE_LIGHTING;
// Office (in the initial bundle) requests on-demand frames through this bridge.
registerSceneFrameRequester(invalidate);

const FLOOR_SIZE = [BUILDING.maxX - BUILDING.minX + 0.2, BUILDING.maxZ - BUILDING.minZ + 0.2] as const;
function RoomPad({ id, color }: { id: SpaceId; color: string }) {
  const pad = roomPad(SPACES[id].rect);
  return <Block at={[(pad.minX + pad.maxX) / 2, 0.025, (pad.minZ + pad.maxZ) / 2]} size={[pad.maxX - pad.minX, 0.04, pad.maxZ - pad.minZ]} color={color} />;
}
/** First person only: a wall between the eye and a label's floor point hides the label (the overview sees over the cut-away walls). */
function behindWall(camera: Camera, x: number, z: number): boolean {
  return (camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true && sightBlocked(camera.position.x, camera.position.z, x, z);
}
/** Sample offsets (m) around a floor point: an avatar is culled only when a wall hides its centre and all four sides. */
const BODY_SAMPLES = [[0, 0], [0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]] as const;
/**
 * First person only: true when walls hide every sample around (x, z), so the avatar's ~20 meshes skip the main,
 * shadow and contact passes. Interior walls are full height and windowless, so the 2D test is exact enough;
 * doorways stay open and the overview never culls.
 */
function bodyBehindWalls(camera: Camera, x: number, z: number): boolean {
  if ((camera as { isPerspectiveCamera?: boolean }).isPerspectiveCamera !== true) return false;
  return BODY_SAMPLES.every(([dx, dz]) => sightBlocked(camera.position.x, camera.position.z, x + dx, z + dz));
}
function ScreenLabel({ at, element }: { at: [number, number, number]; element: LabelRef }) {
  const point = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    point.current.set(...at).project(camera);
    if (!element.current) return;
    element.current.style.visibility = point.current.z > 1 || Math.abs(point.current.x) > 1.05 || Math.abs(point.current.y) > 1.05
      || behindWall(camera, at[0], at[2]) ? 'hidden' : 'visible';
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
    const offscreen = Math.abs(point.current.x) > 1.05 || Math.abs(point.current.y) > 1.05 || point.current.z > 1
      || behindWall(camera, motion.position[0], motion.position[1]);
    tag.style.visibility = offscreen ? 'hidden' : 'visible';
    tag.style.transform = `translate(${(point.current.x + 1) * size.width / 2}px, ${(1 - point.current.y) * size.height / 2}px) translate(-50%, -100%)`;
  });
  return null;
}
/** Draws the shared motion; Office's MotionRegistry owns re-seating, retargeting and the wake-up frame. */
function Avatar({ agent, motion, tween, recorded, paused, onPick }: { agent: OfficeAgent; motion: WalkMotion; tween: boolean; recorded: boolean; paused: boolean; onPick?: OverviewPickHandler }) {
  const reduced = useReducedMotion();
  const body = useRef<Group>(null);
  const [rig] = useState(createBearRig);
  const animator = useAgentAnimator(agentCueKey(agent.id), agent.id, rig);
  useFrame((state, delta) => {
    const walk = motion;
    if (paused) return;
    if (recorded) walk.seat(agent.pos);
    else walk.advance(delta);
    if (walk.moving) state.invalidate();
    if (!body.current) return;
    body.current.position.set(walk.position[0], 0, walk.position[1]);
    body.current.visible = !bodyBehindWalls(state.camera, walk.position[0], walk.position[1]);
    const moving = walk.moving && !tween && !recorded;
    poseBear(rig, walk.distance, moving, reduced);
    // Body turn, head look, breathing, typing and greet/talk beats (lib/office/agent-motion.ts).
    const input = animator.input;
    input.x = walk.position[0]; input.z = walk.position[1]; input.heading = walk.heading; input.moving = moving;
    input.stride = walk.distance; input.desk = walk.moving ? NaN : deskHeading(agent.seatId, walk.position[0], walk.position[1]); input.reduced = reduced;
    animator.animate(state, delta, body.current);
  });
  const bakedVersion = useSyncExternalStore(subscribeBakedCharacters, bakedCharacterVersion, () => 0);
  // The character mount sets this only after that agent's GLB clone exists. Otherwise the bear stays.
  const showGlb = bakedVersion > 0 && bakedCharacterReady(agent.id);
  const color = isAnchorId(agent.seatId) ? OFFICE_ANCHORS[agent.seatId].color : '#9aa38f';
  // Own meshes, not shared Blocks: the folder moves with the agent, so the baked contact-shadow pass must not see it.
  const folder = agent.escalationId ? <group name={`folder:${agent.escalationId}`}>
    <mesh geometry={UNIT_BOX} material={FOLDER_MATERIAL} position={[0.05, 0.04, 0.14]} scale={[0.1, 0.43, 0.5]} castShadow receiveShadow dispose={null} />
    <mesh geometry={UNIT_BOX} material={FOLDER_PAPER_MATERIAL} position={[0.06, 0.13, 0.14]} scale={[0.11, 0.04, 0.34]} castShadow receiveShadow dispose={null} />
  </group> : null;
  // Same paw the bear holds the folder in (bear.ts pawPosition). The GLB has no paw, so the folder sits there on its own.
  const carried = pawPosition(1, BEAR_CARRY_PAW);
  return <group ref={body} name={`agent:${agent.id}`} position={[motion.position[0], 0, motion.position[1]]} {...(onPick ? pickHandlers({ kind: 'agent', id: agent.id }, onPick) : {})}>
    {showGlb ? null : <Bear color={color} seed={agent.id} rig={rig} carry={agent.escalationId ? 'paw' : 'none'} paw={folder} />}
    {showGlb && folder && <group position={[carried[0], carried[1], carried[2]]}>{folder}</group>}
  </group>;
}
// Carried escalation folder (shared for the lazy scene lifetime; dispose={null} on the meshes).
const FOLDER_MATERIAL = new MeshStandardMaterial({ color: '#e0b365', roughness: OFFICE_LIGHTING.base.roughness });
const FOLDER_PAPER_MATERIAL = new MeshStandardMaterial({ color: '#f3dfb9', roughness: OFFICE_LIGHTING.base.roughness });
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
    const zoom = focus ? Math.min(size.width / 10, size.height / 8) : Math.min(size.width / 33, size.height / 22);
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
export function OfficeScene({ snapshot, motions, fixed, tour = false, paused = false, focus, labels, agentTag, onFailure, onRestored, play, presence = [], chatBubbles, onPick }: {
  snapshot: OfficeSnapshot; motions: MotionRegistry; fixed: boolean; tour?: boolean; paused?: boolean; focus: AnchorId | null; labels: RoomLabels;
  agentTag?: AgentTagLookup; onFailure: () => void; onRestored: () => void; play?: PlayBridge; presence?: PresencePeer[]; chatBubbles?: ChatBubble[];
  /** Overview quick actions; only used outside Play. */
  onPick?: OverviewPickHandler;
}) {
  const picking = play ? undefined : onPick;
  const lowPower = useOfficeLowPower();
  return <Canvas role='img' aria-label='3D office floor with agent desks. Use the room buttons to inspect badges and limits.' frameloop='demand' shadows={officeLightRig(lowPower).shadows} dpr={[1, 1.5]} orthographic camera={{ position: [13, 15, 17], zoom: 40, near: 0.1, far: 100 }}
    gl={OFFICE_RENDERER} fallback={<span>3D unavailable. Choose the floor plan.</span>}>
    <color attach='background' args={[ROLES.background]} />
    <OfficeLights snapshot={snapshot} lowPower={lowPower} />
    <Instances limit={240} castShadow receiveShadow frustumCulled={false}>
    <boxGeometry args={[1, 1, 1]} /><meshStandardMaterial roughness={base.roughness} />
    {/* Floor slab, a cream pad per room (tinted while focused) and a blush corridor runner; walls, windows and the ceiling are the WorldShell mount. */}
    <Block at={[0, -0.23, 0]} size={[FLOOR_SIZE[0], 0.45, FLOOR_SIZE[1]]} color={ROLES.floor} />
    <Block at={[(CORRIDOR.minX + CORRIDOR.maxX) / 2, 0.01, CORRIDOR_Z]} size={[CORRIDOR.maxX - CORRIDOR.minX - 0.5, 0.02, 1.3]} color={ROLES.aisle} />
    {SPACE_IDS.filter(id => SPACES[id].kind === 'room' && !isAnchorId(id)).map(id => <RoomPad key={id} id={id} color={ROLES.roomPad} />)}
    {visibleRooms(snapshot).map(room => {
      const { center, color } = OFFICE_ANCHORS[room];
      return <group key={room}>
        <RoomPad id={room} color={focus === room ? color : ROLES.roomPad} />
        {/* Over the room's far wall, clear of the agent tags (agents stand near each room's door). */}
        <ScreenLabel at={[center[0] + 1.2, 1.3, roomRect(room).minZ + 0.3]} element={labels[room]} />
      </group>;
    })}
    {/* Registered scene pieces (./mounts): instanced ones share these Instances; the rest draw after them. */}
    {SCENE_MOUNTS.filter(mount => mount.instanced).map(({ id, Component }) => <Component key={id} snapshot={snapshot} />)}
    <ContactDynamic name='office:agents'>{snapshot.agents.map(agent => <Fragment key={agent.id}>
      <Avatar agent={agent} motion={motions.get(agent)} tween={fixed} recorded={snapshot.connection === 'replay'} paused={paused} onPick={picking} />
      {agentTag && <AgentTag agentId={agent.id} motion={motions.get(agent)} element={agentTag} />}
    </Fragment>)}</ContactDynamic>
    </Instances>
    {SCENE_MOUNTS.filter(mount => !mount.instanced).map(({ id, Component, moving }) => moving
      ? <ContactDynamic key={id}><Component snapshot={snapshot} /></ContactDynamic> : <Component key={id} snapshot={snapshot} />)}
    {picking && <RoomPicks rooms={visibleRooms(snapshot)} onPick={picking} />}
    <ContactDynamic name='office:presence'>{play ? <CoworkerAvatars peers={presence} bubbles={chatBubbles} /> : <PresenceGhosts peers={presence} />}</ContactDynamic>
    {play ? <PlayRig {...play} motions={motions} snapshot={snapshot} /> : <CameraRig focus={focus} fixed={fixed} tour={tour} />}<ContextLoss onFailure={onFailure} onRestored={onRestored} />
  </Canvas>;
}
