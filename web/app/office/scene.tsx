'use client';

import { useEffect, useRef, type ComponentRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Instance, Instances, OrbitControls } from '@react-three/drei';
import { Group, Mesh, MathUtils, Vector3 } from 'three';
import { WalkMotion } from '../../lib/office/motion';
import { OFFICE_ANCHORS, matchingDenial, type AnchorId, type OfficeAgent, type OfficeSnapshot } from '../../lib/office/state';

type LabelRef = RefObject<HTMLDivElement | null>;
export type RoomLabels = Record<AnchorId, LabelRef>;
export const ROOM_IDS = Object.keys(OFFICE_ANCHORS) as AnchorId[];
const deskIds = ['collections', 'payables', 'vendor_onboarding', 'dana'] as const;

function Block({ at, size, color, rotation = 0 }: { at: [number, number, number]; size: [number, number, number]; color: string; rotation?: number }) {
  return <Instance position={at} rotation={[0, rotation, 0]} scale={size} color={color} />;
}
function ScreenLabel({ at, element }: { at: [number, number, number]; element: LabelRef }) {
  const point = useRef(new Vector3());
  useFrame(({ camera, size }) => {
    point.current.set(...at).project(camera);
    if (!element.current) return;
    element.current.style.visibility = Math.abs(point.current.x) > 1.05 || Math.abs(point.current.y) > 1.05 ? 'hidden' : 'visible';
    element.current.style.transform = `translate(${(point.current.x + 1) * size.width / 2}px, ${(1 - point.current.y) * size.height / 2}px) translate(-50%, -50%)`;
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
    <Block at={[-0.35, 1.18, -0.18]} size={[0.67, 0.37, 0.015]} color={accent} />
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
  const denial = matchingDenial(snapshot, room);
  const door = useRef<Mesh>(null);
  const [x] = OFFICE_ANCHORS[room].center;
  useFrame(() => {
    if (!door.current) return;
    const age = denial ? Date.now() - denial.at : Infinity;
    const flash = age >= 0 && age < 4500 && Math.floor(age / 300) % 2 === 0;
    door.current.visible = flash;
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
function Avatar({ agent, tween, recorded }: { agent: OfficeAgent; tween: boolean; recorded: boolean }) {
  const body = useRef<Group>(null);
  const legs = useRef<Group>(null);
  const motion = useRef(new WalkMotion(agent.pos));
  useEffect(() => { motion.current.moveTo(agent.targetAnchor); }, [agent.targetAnchor]);
  useFrame((_, delta) => {
    const walk = motion.current;
    if (recorded) walk.position.splice(0, 2, ...agent.pos);
    else walk.advance(delta);
    if (!body.current) return;
    body.current.position.set(walk.position[0], 0, walk.position[1]);
    const turn = MathUtils.euclideanModulo(walk.heading - body.current.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
    body.current.rotation.y += turn * (1 - Math.exp(-12 * Math.min(delta, 0.1)));
    if (legs.current) legs.current.children.forEach((leg, i) => { leg.rotation.x = walk.moving && !tween && !recorded ? Math.sin(walk.distance * 9 + i * Math.PI) * 0.38 : 0; });
  });
  const color = OFFICE_ANCHORS[agent.seatId].color;
  return <group ref={body} position={[agent.pos[0], 0, agent.pos[1]]}>
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
function CameraRig({ focus, fixed }: { focus: AnchorId | null; fixed: boolean }) {
  const { camera, size } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const moving = useRef(true);
  const target = useRef(new Vector3());
  const destination = useRef(new Vector3(13, 15, 17));
  useEffect(() => {
    const center = focus ? OFFICE_ANCHORS[focus].center : [0, 0];
    target.current.set(center[0]!, 0.2, center[1]!);
    destination.current.copy(target.current).add(new Vector3(13, 15, 17));
    moving.current = true;
  }, [focus, size, fixed]);
  useFrame((_, delta) => {
    if (!moving.current || !controls.current) return;
    const alpha = 1 - Math.exp(-7 * Math.min(delta, 0.1));
    camera.position.lerp(destination.current, alpha);
    controls.current.target.lerp(target.current, alpha);
    const zoom = focus ? Math.min(size.width / 10, size.height / 8) : Math.min(size.width / 22, size.height / 16);
    camera.zoom = MathUtils.lerp(camera.zoom, zoom, alpha);
    camera.updateProjectionMatrix();
    controls.current.update();
    if (camera.position.distanceTo(destination.current) < 0.005 && Math.abs(camera.zoom - zoom) < 0.01) moving.current = false;
  });
  return <OrbitControls ref={controls} enablePan={false} enableZoom={false} enableRotate={!fixed}
    minPolarAngle={0.45} maxPolarAngle={1.1} minAzimuthAngle={-0.7} maxAzimuthAngle={0.9} />;
}
function ContextLoss({ onFailure }: { onFailure: () => void }) {
  const gl = useThree(state => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', onFailure);
    return () => canvas.removeEventListener('webglcontextlost', onFailure);
  }, [gl, onFailure]);
  return null;
}
export function OfficeScene({ snapshot, fixed, focus, labels, onFailure }: {
  snapshot: OfficeSnapshot; fixed: boolean; focus: AnchorId | null; labels: RoomLabels; onFailure: () => void;
}) {
  return <Canvas shadows dpr={[1, 1.5]} orthographic camera={{ position: [13, 15, 17], zoom: 40, near: 0.1, far: 100 }}
    gl={{ antialias: true, powerPreference: 'high-performance' }} fallback={<span>3D unavailable. Choose the floor plan.</span>}>
    <color attach='background' args={['#202620']} />
    <ambientLight intensity={1.7} />
    <directionalLight position={[2, 12, 6]} intensity={2.5} castShadow shadow-mapSize={[1024, 1024]}
      shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={10} shadow-camera-bottom={-10} />
    <Instances limit={200} castShadow receiveShadow frustumCulled={false}>
    <boxGeometry args={[1, 1, 1]} /><meshStandardMaterial roughness={0.9} />
    <Block at={[0, -0.23, 0]} size={[16, 0.45, 11]} color='#535c4e' />
    <Block at={[0, 0.55, -5.5]} size={[16, 1.1, 0.16]} color='#828976' />
    <Block at={[-8, 0.55, 0]} size={[0.16, 1.1, 11]} color='#747e6a' />
    <Block at={[0, 0.01, 0.6]} size={[15.8, 0.02, 1.3]} color='#687361' />
    {[-2.5, 2.5].map(x => <group key={x}>
      <Block at={[x, 0.38, -3.15]} size={[0.12, 0.76, 4.6]} color='#828976' />
      <Block at={[x, 0.38, 3.5]} size={[0.12, 0.76, 3.8]} color='#828976' />
    </group>)}
    {ROOM_IDS.map(room => {
      const { center, color } = OFFICE_ANCHORS[room];
      return <group key={room}>
        <Block at={[center[0], 0.025, center[1]]} size={[4.25, 0.04, room === 'lobby' ? 3.6 : 3.4]} color={focus === room ? color : '#626e5b'} />
        <Door room={room} snapshot={snapshot} />
        <ScreenLabel at={[center[0], 2.5, center[1] - 0.3]} element={labels[room]} />
      </group>;
    })}
    {deskIds.map(room => <Desk key={room} room={room} />)}
    <group position={[-5.9, 0, 3.9]}>
      <Block at={[0, 1.25, 0]} size={[2, 1.45, 0.15]} color='#303d34' />
      {[0, 1, 2].map(i => <Block key={i} at={[0, 1.65 - i * 0.35, -0.09]} size={[1.55, 0.09, 0.04]} color={i === 1 ? '#cc9c7d' : '#a9bc8f'} />)}
      <Block at={[1.5, 0.72, -0.8]} size={[0.8, 0.12, 1]} color='#bcaa8c' />
      {[0, 1, 2].map(i => <Block key={i} at={[1.5, 0.84 + i * 0.09, -0.8]} size={[0.5, 0.06, 0.65]} color='#e7ddc5' rotation={i * 0.06} />)}
    </group>
    <Block at={[5, 0.7, 4]} size={[1.8, 1.4, 1.25]} color='#3d4e47' />
    <Block at={[5, 0.7, 3.35]} size={[1.4, 1.05, 0.08]} color='#718176' />
    <Block at={[5, 0.7, 3.28]} size={[0.12, 0.48, 0.1]} color='#c3b68e' />
    <Plant x={-7.1} z={-4.6} /><Plant x={7.1} z={-4.6} /><Plant x={1.7} z={4.5} />
    {snapshot.agents.map(agent => <Avatar key={agent.id} agent={agent} tween={fixed} recorded={snapshot.connection === 'replay'} />)}
    </Instances>
    <CameraRig focus={focus} fixed={fixed} /><ContextLoss onFailure={onFailure} />
  </Canvas>;
}
