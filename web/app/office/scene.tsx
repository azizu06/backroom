'use client';

import { Fragment, useEffect, useRef, useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import { Canvas, invalidate, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, Instance, Instances, OrbitControls } from '@react-three/drei';
import { Group, Mesh, MathUtils, Vector3, type MeshBasicMaterial } from 'three';
import { REDUCED_MOTION_QUERY, cameraAlpha, doorHighlight, legSwing } from '../../lib/office/a11y';
import type { MotionRegistry, WalkMotion } from '../../lib/office/motion';
import type { PlayBridge } from '../../lib/office/play';
import { PlayRig } from './play';
import { OFFICE_ANCHORS, isAnchorId, matchingDenial, visibleRooms, type AnchorId, type OfficeAgent, type OfficeSnapshot } from '../../lib/office/state';
import { registerSceneFrameRequester } from '../../lib/office/frame';
import { tourProgress } from '../../lib/office/tour';
import { OFFICE_LIGHTING } from '../../lib/office/lighting';
import { ServerRoom } from './rooms/ServerRoom';
import { HandoffLayer, type HandoffTagLookup } from './handoffs/HandoffLayer';
import type { HandoffStage } from '../../lib/office/handoff-plan';
import { OfficeProps } from './props/OfficeProps';

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => false);
}

type LabelRef = RefObject<HTMLDivElement | null>;
export type RoomLabels = Record<AnchorId, LabelRef>;
/** Looks up the HTML tag element Office renders for an agent id. */
export type AgentTagLookup = (agentId: string) => HTMLDivElement | undefined;
export const ROOM_IDS = Object.keys(OFFICE_ANCHORS) as AnchorId[];
const deskIds = ['collections', 'payables', 'vendor_onboarding', 'dana'] as const;
const { key: keyLight, fill: fillLight, hemisphere, contactShadows, base, screen, vault } = OFFICE_LIGHTING;
// Office (in the initial bundle) requests on-demand frames through this bridge.
registerSceneFrameRequester(invalidate);

function Block({ at, size, color, rotation = 0 }: { at: [number, number, number]; size: [number, number, number]; color: string; rotation?: number }) {
  return <Instance position={at} rotation={[0, rotation, 0]} scale={size} color={color} />;
}
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
function Desk({ room }: { room: typeof deskIds[number] }) {
  const [x, z] = OFFICE_ANCHORS[room].center;
  const accent = OFFICE_ANCHORS[room].color;
  const facing = room === 'dana' ? Math.PI : 0;
  return <group position={[x, 0, z]} rotation={[0, facing, 0]}>
    <Block at={[0, 0.83, 0]} size={[2.25, 0.16, 1.05]} color='#bcaa8c' />
    {[-0.9, 0.9].map(x => <Block key={x} at={[x, 0.4, 0]} size={[0.13, 0.8, 0.8]} color='#485049' />)}
    <Block at={[-0.35, 1.18, -0.23]} size={[0.78, 0.5, 0.08]} color='#343d36' />
    {/* A plain mesh, not an instance, so the screen gets its own glossy material. */}
    <mesh position={[-0.35, 1.18, -0.18]} castShadow receiveShadow>
      <boxGeometry args={[0.67, 0.37, 0.015]} />
      <meshPhysicalMaterial color={accent} emissive={accent} emissiveIntensity={screen.emissiveIntensity} roughness={screen.roughness}
        metalness={screen.metalness} clearcoat={screen.clearcoat} clearcoatRoughness={screen.clearcoatRoughness} />
    </mesh>
    <Block at={[-0.35, 0.96, -0.23]} size={[0.1, 0.22, 0.1]} color='#485049' />
    <Block at={[0.65, 0.95, 0.1]} size={[0.4, 0.06, 0.5]} color='#e7ddc5' rotation={-0.12} />
    <Block at={[0.05, 0.45, -0.9]} size={[0.65, 0.14, 0.6]} color={accent} />
    <Block at={[0.05, 0.77, -1.14]} size={[0.65, 0.65, 0.12]} color={accent} />
  </group>;
}
function Plant({ x, z }: { x: number; z: number }) {
  return <group position={[x, 0, z]}>
    <mesh position={[0, 0.22, 0]} castShadow><cylinderGeometry args={[0.27, 0.18, 0.44, 6]} /><meshStandardMaterial color='#b98667' /></mesh>
    <mesh position={[0, 0.8, 0]} castShadow><dodecahedronGeometry args={[0.5, 0]} /><meshStandardMaterial color='#81936b' /></mesh>
  </group>;
}
function Door({ room, snapshot }: { room: AnchorId; snapshot: OfficeSnapshot }) {
  const reduced = useReducedMotion();
  const denial = matchingDenial(snapshot, room);
  const door = useRef<Mesh>(null);
  const invalidate = useThree(state => state.invalidate);
  const [x] = OFFICE_ANCHORS[room].center;
  useEffect(() => { if (denial) invalidate(); }, [denial, invalidate]);
  useFrame(({ invalidate }) => {
    if (!door.current) return;
    // Ages clamp at 0: clock skew can put a row's `at` ahead of this clock (same rule as doorFlash).
    const age = denial ? Math.max(0, Date.now() - denial.at) : Infinity;
    const highlight = doorHighlight(age, reduced);
    door.current.visible = highlight.visible;
    if (highlight.visible) invalidate();
    (door.current.material as MeshBasicMaterial).opacity = highlight.opacity;
  });
  if (room === 'lobby' || room === 'dana') return null;
  const z = room === 'treasury' ? 1.15 : -0.65;
  return <group>
    <Block at={[x - 0.72, 0.52, z]} size={[0.14, 1.04, 0.18]} color='#7d8874' />
    <Block at={[x + 0.72, 0.52, z]} size={[0.14, 1.04, 0.18]} color='#7d8874' />
    {room === 'treasury' && <>
      <Block at={[x, 0.51, z]} size={[1.3, 1.02, 0.12]} color='#3c4d47' />
      <Block at={[x, 0.62, z - 0.09]} size={[0.3, 0.28, 0.08]} color='#c3b68e' />
    </>}
    <mesh ref={door} visible={false} position={[x, 0.65, z]}><boxGeometry args={[1.5, 1.3, 0.2]} /><meshBasicMaterial color='#ed6252' transparent opacity={0.85} /></mesh>
  </group>;
}
/** Draws the shared motion; Office's MotionRegistry owns re-seating, retargeting and the wake-up frame. */
function Avatar({ agent, motion, tween, recorded, paused }: { agent: OfficeAgent; motion: WalkMotion; tween: boolean; recorded: boolean; paused: boolean }) {
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
    if (legs.current) legs.current.children.forEach((leg, i) => { leg.rotation.x = legSwing(walk.distance, i, walk.moving && !tween && !recorded, reduced); });
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
export function OfficeScene({ snapshot, motions, fixed, tour = false, paused = false, focus, labels, agentTag, onFailure, onRestored, play, handoffs, handoffTag }: {
  snapshot: OfficeSnapshot; motions: MotionRegistry; fixed: boolean; tour?: boolean; paused?: boolean; focus: AnchorId | null; labels: RoomLabels;
  agentTag?: AgentTagLookup; onFailure: () => void; onRestored: () => void; play?: PlayBridge;
  handoffs?: HandoffStage; handoffTag?: HandoffTagLookup;
}) {
  return <Canvas role='img' aria-label='3D office floor with agent desks. Use the room buttons to inspect badges and limits.' frameloop='demand' shadows dpr={[1, 1.5]} orthographic camera={{ position: [13, 15, 17], zoom: 40, near: 0.1, far: 100 }}
    gl={{ antialias: true, powerPreference: 'high-performance' }} fallback={<span>3D unavailable. Choose the floor plan.</span>}>
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
        <Door room={room} snapshot={snapshot} />
        <ScreenLabel at={[center[0], 2.5, center[1] - 0.3]} element={labels[room]} />
      </group>;
    })}
    {deskIds.filter(room => visibleRooms(snapshot).includes(room)).map(room => <Desk key={room} room={room} />)}
    {visibleRooms(snapshot).includes('lobby') && <group position={[-5.9, 0, 3.9]}>
      <Block at={[0, 1.25, 0]} size={[2, 1.45, 0.15]} color='#303d34' />
      {snapshot.audit.slice(-3).map((row, i) => <Block key={row.id} at={[0, 1.65 - i * 0.35, -0.09]} size={[1.55, 0.09, 0.04]} color={row.decision === 'DENY' ? '#ed6252' : '#a9bc8f'} />)}
      <Block at={[1.5, 0.72, -0.8]} size={[0.8, 0.12, 1]} color='#bcaa8c' />
      {Array.from({ length: Math.min(snapshot.inboxCount, 3) }, (_, i) => <Block key={i} at={[1.5, 0.84 + i * 0.09, -0.8]} size={[0.5, 0.06, 0.65]} color='#e7ddc5' rotation={i * 0.06} />)}
    </group>}
    {visibleRooms(snapshot).includes('treasury') && <group>
    <Block at={[5, 0.7, 4]} size={[1.8, 1.4, 1.25]} color='#3d4e47' />
    <mesh position={[5, 0.7, 3.35]} castShadow receiveShadow>
      <boxGeometry args={[1.4, 1.05, 0.08]} />
      <meshStandardMaterial color={vault.color} roughness={vault.roughness} metalness={vault.metalness} />
    </mesh>
    <Block at={[5, 0.7, 3.28]} size={[0.12, 0.48, 0.1]} color='#c3b68e' />
    </group>}
    <Plant x={-7.1} z={-4.6} /><Plant x={7.1} z={-4.6} /><Plant x={1.7} z={4.5} />
    {snapshot.agents.map(agent => <Fragment key={agent.id}>
      <Avatar agent={agent} motion={motions.get(agent)} tween={fixed} recorded={snapshot.connection === 'replay'} paused={paused} />
      {agentTag && <AgentTag agentId={agent.id} motion={motions.get(agent)} element={agentTag} />}
    </Fragment>)}
    </Instances>
    <ServerRoom position={[7.1, 0, -0.8]} />
    <OfficeProps snapshot={snapshot} />
    {handoffs && <HandoffLayer stage={handoffs} tag={handoffTag} />}
    {play ? <PlayRig {...play} handoffs={handoffs} motions={motions} snapshot={snapshot} /> : <CameraRig focus={focus} fixed={fixed} tour={tour} />}<ContextLoss onFailure={onFailure} onRestored={onRestored} />
  </Canvas>;
}
