'use client';

import { useLayoutEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { Object3D, type InstancedMesh } from 'three';
import { visibleRooms } from '../../../lib/office/state';
import { INBOX_SHEET_LIMIT, inboxSheets } from '../../../lib/office/props/inboxStack';
import type { SceneMountProps } from '../mounts/types';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';

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

/** Upright count plate turned toward the lobby camera; the room chip already says "inbox", so only the number is drawn, large. */
function Label({ count }: { count: number }) {
  const text = String(Math.max(0, Math.floor(Number.isFinite(count) ? count : 0)));
  const texture = useCanvasTexture(192, 128, ctx => {
    ctx.fillStyle = '#272f25';
    ctx.fillRect(0, 0, 192, 128);
    ctx.strokeStyle = '#8b987b';
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 186, 122);
    ctx.fillStyle = '#d0d6c6';
    ctx.font = `800 104px ${PROP_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 96, 68, 170);
  }, [text]);
  return <mesh position={[0.17, 0.1, 0.36]} rotation={[0, Math.PI / 4, 0]}>
    <planeGeometry args={[0.3, 0.2]} /><meshBasicMaterial map={texture} toneMapped={false} />
  </mesh>;
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
    <Label count={snapshot.inboxCount} />
  </group>;
}
