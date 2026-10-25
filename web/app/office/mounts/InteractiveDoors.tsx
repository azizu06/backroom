'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { DOOR_DEPTH, DOOR_LEAF_HEIGHT, DOOR_WIDTH, doorAngle, doorPosition, INTERIOR_DOORS, type DoorId } from '../../../lib/office/doors';
import { interactionStore } from '../../../lib/office/interactions';
import { OFFICE_ANCHORS, visibleRooms } from '../../../lib/office/state';
import { useSceneTextNode } from '../props/useSceneTextNode';
import { useReducedMotion } from './shared';
import type { SceneMountProps } from './types';

function DoorLeaf({ room }: { room: DoorId }) {
  const { doors } = useSyncExternalStore(interactionStore.subscribe, interactionStore.getSnapshot, interactionStore.getServerSnapshot);
  const open = doors[room];
  const reduced = useReducedMotion();
  const pivot = useRef<Group>(null);
  const initialAngle = useRef(open ? -Math.PI / 2 : 0);
  const invalidate = useThree(state => state.invalidate);
  const [x, z] = doorPosition(room);
  useSceneTextNode(`office-door-${room}`, `${OFFICE_ANCHORS[room].name} door ${open ? 'open' : 'closed'}`);
  useEffect(() => { invalidate(); }, [open, reduced, invalidate]);
  useFrame((state, dt) => {
    if (!pivot.current) return;
    // Demand rendering can leave a large idle delta; the first wake must still animate.
    const angle = doorAngle(pivot.current.rotation.y, open, Math.min(dt, 1 / 30), reduced);
    pivot.current.rotation.y = angle;
    if (angle !== (open ? -Math.PI / 2 : 0)) state.invalidate();
  });
  return <group ref={pivot} rotation-y={initialAngle.current} name={`door:${room}`} position={[x - DOOR_WIDTH / 2, 0, z]}>
    <mesh position={[DOOR_WIDTH / 2, DOOR_LEAF_HEIGHT / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[DOOR_WIDTH, DOOR_LEAF_HEIGHT, DOOR_DEPTH]} /><meshStandardMaterial color={OFFICE_ANCHORS[room].color} roughness={0.9} />
    </mesh>
    {[-1, 1].map(side => <mesh key={side} position={[DOOR_WIDTH - 0.12, 1.02, side * 0.085]}>
      <boxGeometry args={[0.12, 0.035, 0.05]} /><meshStandardMaterial color='#f3dfb9' />
    </mesh>)}
  </group>;
}

/** Moving leaves complement the existing frames/denial flashes; Treasury keeps its locked mesh. */
export function InteractiveDoors({ snapshot }: SceneMountProps) {
  const rooms = visibleRooms(snapshot);
  return <>{INTERIOR_DOORS.filter(room => rooms.includes(room)).map(room => <DoorLeaf key={room} room={room} />)}</>;
}
