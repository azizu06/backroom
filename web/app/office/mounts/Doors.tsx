'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Mesh, MeshBasicMaterial } from 'three';
import { doorHighlight } from '../../../lib/office/a11y';
import { OFFICE_ANCHORS, matchingDenial, visibleRooms, type AnchorId, type OfficeSnapshot } from '../../../lib/office/state';
import { Block, useReducedMotion } from './shared';
import type { SceneMountProps } from './types';

/** Room doorway; flashes red while a matching DENY row is fresh. */
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

/** One door (with its DENY flash) per visible room. */
export function Doors({ snapshot }: SceneMountProps) {
  return <>{visibleRooms(snapshot).map(room => <Door key={room} room={room} snapshot={snapshot} />)}</>;
}
