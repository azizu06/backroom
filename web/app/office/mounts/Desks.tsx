'use client';

import { OFFICE_ANCHORS, visibleRooms } from '../../../lib/office/state';
import { OFFICE_LIGHTING } from '../../../lib/office/lighting';
import { MONITOR_FACE } from '../../../lib/office/props/monitors';
import { DESKS } from '../../../lib/office/targets/desk';
import { Block } from './shared';
import type { SceneMountProps } from './types';

const { screen } = OFFICE_LIGHTING;

function Desk({ room }: { room: typeof DESKS[number] }) {
  const [x, z] = OFFICE_ANCHORS[room].center;
  const accent = OFFICE_ANCHORS[room].color;
  const facing = room === 'dana' ? Math.PI : 0;
  return <group position={[x, 0, z]} rotation={[0, facing, 0]}>
    <Block at={[0, 0.83, 0]} size={[2.25, 0.16, 1.05]} color='#bcaa8c' />
    {[-0.9, 0.9].map(x => <Block key={x} at={[x, 0.4, 0]} size={[0.13, 0.8, 0.8]} color='#485049' />)}
    <group position={[MONITOR_FACE.x, MONITOR_FACE.y, MONITOR_FACE.z]} rotation={[0, room === 'dana' ? Math.PI : 0, 0]}>
      <Block at={[0, 0, 0]} size={[MONITOR_FACE.width + 0.1, MONITOR_FACE.height + 0.1, 0.08]} color='#343d36' />
      {/* A plain mesh, not an instance, so the screen gets its own glossy material. */}
      <mesh position={[0, 0, 0.05]} castShadow receiveShadow>
        <boxGeometry args={[MONITOR_FACE.width + 0.01, MONITOR_FACE.height + 0.01, 0.015]} />
        <meshPhysicalMaterial color={accent} emissive={accent} emissiveIntensity={screen.emissiveIntensity} roughness={screen.roughness}
          metalness={screen.metalness} clearcoat={screen.clearcoat} clearcoatRoughness={screen.clearcoatRoughness} />
      </mesh>
    </group>
    <Block at={[MONITOR_FACE.x, 0.96, MONITOR_FACE.z]} size={[0.1, 0.22, 0.1]} color='#485049' />
    <Block at={[0.65, 0.95, 0.1]} size={[0.4, 0.06, 0.5]} color='#e7ddc5' rotation={-0.12} />
    <Block at={[0.05, 0.45, -0.9]} size={[0.65, 0.14, 0.6]} color={accent} />
    <Block at={[0.05, 0.77, -1.14]} size={[0.65, 0.65, 0.12]} color={accent} />
  </group>;
}

/** Agent and Dana desks in visible rooms; their footprints are mirrored in officeColliders. */
export function Desks({ snapshot }: SceneMountProps) {
  return <>{DESKS.filter(room => visibleRooms(snapshot).includes(room)).map(room => <Desk key={room} room={room} />)}</>;
}
