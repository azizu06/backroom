'use client';

import { useLayoutEffect, useRef } from 'react';
import { Billboard } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { Object3D, OrthographicCamera, type Group, type InstancedMesh } from 'three';
import { visibleRooms } from '../../../lib/office/state';
import { INBOX_LABEL_ASPECT, INBOX_LABEL_GLYPH, INBOX_SHEET_LIMIT, inboxLabelHeight, inboxSheets } from '../../../lib/office/props/inboxStack';
import type { SceneMountProps } from '../mounts/types';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';
import { useSceneTextNode } from './useSceneTextNode';
import { LOBBY_KIOSK } from '../../../lib/office/layout';

const [KIOSK_X, KIOSK_Z] = LOBBY_KIOSK;

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

const LABEL_W = 256;
const LABEL_H = LABEL_W / INBOX_LABEL_ASPECT;
/** Bottom edge of the label, just above a full paper stack. */
const LABEL_BASE = 0.22;

/** Camera-facing label resized each frame to a fixed pixel height, so it reads at every orthographic zoom. */
function Label({ count }: { count: number }) {
  const text = `Inbox · ${count}`;
  useSceneTextNode('lobby-inbox-label', text);
  const texture = useCanvasTexture(LABEL_W, LABEL_H, ctx => {
    ctx.fillStyle = '#272f25';
    ctx.fillRect(0, 0, LABEL_W, LABEL_H);
    ctx.strokeStyle = '#8b987b';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, LABEL_W - 3, LABEL_H - 3);
    ctx.fillStyle = '#d0d6c6';
    ctx.font = `700 ${Math.round(LABEL_H * INBOX_LABEL_GLYPH)}px ${PROP_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, LABEL_W / 2, LABEL_H / 2 + 2, LABEL_W - 16);
  }, [text]);
  const group = useRef<Group>(null);
  useFrame(({ camera }) => {
    if (!group.current) return;
    const height = inboxLabelHeight(camera.zoom, camera instanceof OrthographicCamera);
    group.current.scale.setScalar(height);
    group.current.position.y = LABEL_BASE + height / 2;
  });
  return <Billboard ref={group} position={[0, LABEL_BASE, 0]}>
    <mesh renderOrder={10}>
      <planeGeometry args={[INBOX_LABEL_ASPECT, 1]} />
      <meshBasicMaterial map={texture} transparent depthTest={false} depthWrite={false} toneMapped={false} />
    </mesh>
  </Billboard>;
}

/** Sits entirely on the existing lobby counter, inside its Play collider. */
export function LobbyInbox({ snapshot }: SceneMountProps) {
  if (!visibleRooms(snapshot).includes('lobby')) return null;
  return <group name='prop:lobby-inbox' position={[KIOSK_X - 0.17, 0.79, KIOSK_Z]}>
    <mesh receiveShadow><boxGeometry args={[0.4, 0.025, 0.5]} /><meshStandardMaterial color='#8b987b' /></mesh>
    {[-1, 1].map(side => <mesh key={side} position={[side * 0.19, 0.04, 0]}>
      <boxGeometry args={[0.02, 0.08, 0.5]} /><meshStandardMaterial color='#272f25' />
    </mesh>)}
    <Papers count={snapshot.inboxCount} />
    <Label count={snapshot.inboxCount} />
  </group>;
}
