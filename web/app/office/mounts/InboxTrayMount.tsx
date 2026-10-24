'use client';

import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { Mesh } from 'three';
import { PROP_FONT, useCanvasTexture } from '../props/useCanvasTexture';
import { promptText, withinReach } from '../../../lib/office/props/prompt';
import { INBOX_TRAY, INBOX_TRAY_RADIUS } from '../../../lib/office/targets/inbox';
import { OFFICE_ANCHORS, visibleRooms } from '../../../lib/office/state';
import type { SceneMountProps } from './types';

const DESK_TOP = 0.91;
const MAX_PAPERS = 3;
/** Eye height band of Play; orbit and plan cameras sit higher, so they never show the prompt. */
const EYE_MAX_Y = 2.2;
const { center } = OFFICE_ANCHORS.payables;

function Tray({ snapshot }: SceneMountProps) {
  const count = snapshot.inboxCount;
  const card = useCanvasTexture(256, 96, ctx => {
    ctx.fillStyle = '#f1ede2'; ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#303d34'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = `600 26px ${PROP_FONT}`; ctx.fillText('Inbox', 14, 48);
    ctx.textAlign = 'right'; ctx.font = `700 54px ${PROP_FONT}`; ctx.fillText(String(count), 242, 50);
  }, [count]);
  const prompt = useCanvasTexture(256, 64, ctx => {
    ctx.fillStyle = '#18201b'; ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#d8e5d0'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.font = `600 34px ${PROP_FONT}`; ctx.fillText(promptText('open'), 128, 34);
  }, []);
  const plate = useRef<Mesh>(null);
  const canvas = useThree(state => state.gl.domElement);
  // Runs only on rendered frames (Play requests them while you move); never schedules its own.
  useFrame(({ camera }) => {
    if (!plate.current) return;
    const near = camera.position.y < EYE_MAX_Y && withinReach([camera.position.x, camera.position.z], INBOX_TRAY, INBOX_TRAY_RADIUS);
    plate.current.visible = near;
    canvas.dataset.inboxPrompt = near ? promptText('open') : '';
  });
  const [x, z] = [INBOX_TRAY[0] - center[0], INBOX_TRAY[1] - center[1]];
  return <group name='mount:inbox-tray' position={[center[0], 0, center[1]]}>
    <mesh position={[x, DESK_TOP + 0.02, z]} receiveShadow>
      <boxGeometry args={[0.42, 0.04, 0.3]} /><meshStandardMaterial color='#7d8874' roughness={0.8} />
    </mesh>
    {Array.from({ length: Math.min(count, MAX_PAPERS) }, (_, i) => <mesh key={i} position={[x, DESK_TOP + 0.07 + i * 0.05, z]} rotation={[0, i * 0.12, 0]}>
      <boxGeometry args={[0.34, 0.045, 0.24]} /><meshStandardMaterial color='#e7ddc5' roughness={0.9} />
    </mesh>)}
    <mesh position={[x, DESK_TOP + 0.2, z - 0.13]}>
      <planeGeometry args={[0.3, 0.11]} /><meshBasicMaterial map={card} toneMapped={false} />
    </mesh>
    <mesh ref={plate} visible={false} position={[x, DESK_TOP + 0.44, z]}>
      <planeGeometry args={[0.36, 0.09]} /><meshBasicMaterial map={prompt} toneMapped={false} />
    </mesh>
  </group>;
}

/** Inbox tray on the Payables desk: paper stack and count card; a floating "E: open" shows when you are within reach. */
export function InboxTrayMount({ snapshot }: SceneMountProps) {
  return visibleRooms(snapshot).includes('payables') ? <Tray snapshot={snapshot} /> : null;
}
