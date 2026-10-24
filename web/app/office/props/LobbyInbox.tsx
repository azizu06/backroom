'use client';

import { useLayoutEffect, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Object3D, type InstancedMesh } from 'three';
import { visibleRooms } from '../../../lib/office/state';
import { INBOX_SHEET_LIMIT, inboxSheets } from '../../../lib/office/props/inboxStack';
import type { SceneMountProps } from '../mounts/types';

function Papers({ count }: { count: number }) {
  const mesh = useRef<InstancedMesh>(null);
  const invalidate = useThree(state => state.invalidate);
  const sheets = inboxSheets(count);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const sheet = new Object3D();
    for (let i = 0; i < sheets; i++) {
      sheet.position.set(0, 0.034 + i * 0.012, 0);
      sheet.rotation.y = (i % 3 - 1) * 0.035;
      sheet.updateMatrix();
      mesh.current.setMatrixAt(i, sheet.matrix);
    }
    mesh.current.count = sheets;
    mesh.current.instanceMatrix.needsUpdate = true;
    invalidate();
  }, [sheets, invalidate]);
  return <instancedMesh ref={mesh} args={[undefined, undefined, INBOX_SHEET_LIMIT]} castShadow receiveShadow frustumCulled={false}>
    <boxGeometry args={[0.34, 0.009, 0.44]} /><meshStandardMaterial color='#e7ddc5' roughness={1} />
  </instancedMesh>;
}

/** Sits entirely on the existing lobby counter, inside its Play collider. */
export function LobbyInbox({ snapshot }: SceneMountProps) {
  if (!visibleRooms(snapshot).includes('lobby')) return null;
  return <group name='prop:lobby-inbox' position={[-4.57, 0.79, 3.1]}>
    <mesh receiveShadow><boxGeometry args={[0.4, 0.025, 0.5]} /><meshStandardMaterial color='#8b987b' /></mesh>
    {[-1, 1].map(side => <mesh key={side} position={[side * 0.19, 0.04, 0]}>
      <boxGeometry args={[0.02, 0.08, 0.5]} /><meshStandardMaterial color='#272f25' />
    </mesh>)}
    <Papers count={snapshot.inboxCount} />
    <Html center position={[0, 0.035, 0.28]} style={{ pointerEvents: 'none' }}>
      <span style={{ display: 'block', whiteSpace: 'nowrap', fontSize: 10, padding: '2px 5px', background: '#272f25', border: '1px solid #8b987b', color: '#d0d6c6' }}>Inbox · {snapshot.inboxCount}</span>
    </Html>
  </group>;
}
