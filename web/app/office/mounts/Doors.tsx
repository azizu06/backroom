'use client';

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BoxGeometry, type Mesh, type MeshBasicMaterial } from 'three';
import { doorHighlight } from '../../../lib/office/a11y';
import { matchingDenial, visibleRooms, type AnchorId, type OfficeSnapshot } from '../../../lib/office/state';
import { Block, useReducedMotion } from './shared';
import { DOOR_LEAF_HEIGHT, doorPosition, type DoorId } from '../../../lib/office/doors';
import { DOOR_OPENING_HEIGHT as DOOR_POST_TOP } from '../../../lib/office/layout';
import { TREASURY_DOOR } from '../../../lib/office/targets/treasury';
import type { SceneMountProps } from './types';
import { PALETTE, ROLES } from '../../../lib/office/palette';

const HIGHLIGHT_GEOMETRY = new BoxGeometry(1.5, 2.2, 0.2);

/** Room doorway; flashes red while a matching DENY row is fresh. */
function Door({ room, snapshot }: { room: AnchorId; snapshot: OfficeSnapshot }) {
  const reduced = useReducedMotion();
  const denial = matchingDenial(snapshot, room);
  const door = useRef<Mesh>(null);
  const invalidate = useThree(state => state.invalidate);
  const [x, z] = room === 'treasury' ? TREASURY_DOOR : doorPosition(room as DoorId);
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
  return <group>
    <Block at={[x - 0.72, DOOR_POST_TOP / 2, z]} size={[0.14, DOOR_POST_TOP, 0.18]} color={PALETTE.aqua} />
    <Block at={[x + 0.72, DOOR_POST_TOP / 2, z]} size={[0.14, DOOR_POST_TOP, 0.18]} color={PALETTE.aqua} />
    {room === 'treasury' && <>
      <Block at={[x, DOOR_LEAF_HEIGHT / 2, z]} size={[1.3, DOOR_LEAF_HEIGHT, 0.12]} color={ROLES.frame} />
      <Block at={[x, 1.15, z - 0.09]} size={[0.3, 0.28, 0.08]} color={PALETTE.butter} />
    </>}
    <mesh ref={door} visible={false} position={[x, 1.1, z]}><primitive object={HIGHLIGHT_GEOMETRY} attach='geometry' /><meshBasicMaterial color={ROLES.deny} transparent opacity={0.85} /></mesh>
  </group>;
}

/** One door (with its DENY flash) per visible room. */
export function Doors({ snapshot }: SceneMountProps) {
  return <>{visibleRooms(snapshot).filter(room => room !== 'lobby' && room !== 'dana').map(room => <Door key={room} room={room} snapshot={snapshot} />)}</>;
}
