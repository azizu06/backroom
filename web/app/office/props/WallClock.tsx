'use client';

import { useEffect, useState } from 'react';
import type { OfficeSnapshot } from '../../../lib/office/state';
import { CLOCK_INTERACTION, clockFace, msUntilNextMinute } from '../../../lib/office/props/clock';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';

const RADIUS = 0.4, TEX = 256;

function drawFace(ctx: CanvasRenderingContext2D, text: string, receipts: number) {
  const c = TEX / 2;
  ctx.fillStyle = '#f1ede2';
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#303d34';
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6, major = i % 3 === 0;
    const inner = major ? c - 34 : c - 24;
    ctx.lineWidth = major ? 7 : 4;
    ctx.beginPath();
    ctx.moveTo(c + Math.sin(angle) * inner, c - Math.cos(angle) * inner);
    ctx.lineTo(c + Math.sin(angle) * (c - 12), c - Math.cos(angle) * (c - 12));
    ctx.stroke();
  }
  ctx.fillStyle = '#303d34';
  ctx.textAlign = 'center';
  ctx.font = `600 24px ${PROP_FONT}`;
  ctx.fillText(text, c, c + 52);
  ctx.fillStyle = '#6b6f63';
  ctx.font = `500 17px ${PROP_FONT}`;
  ctx.fillText(`receipts ${receipts}`, c, c + 76);
}

function Hand({ angle, length, width, z }: { angle: number; length: number; width: number; z: number }) {
  return <group rotation={[0, 0, -angle]} position={[0, 0, z]}>
    <mesh position={[0, length / 2 - 0.03, 0]} receiveShadow>
      <boxGeometry args={[width, length, 0.012]} /><meshStandardMaterial color='#303d34' />
    </mesh>
  </group>;
}

function Clock({ receipts }: { receipts: number }) {
  const [now, setNow] = useState(() => Date.now());
  // One state change per minute, aligned to the boundary; no frame loop and no second hand (same under reduced motion).
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), msUntilNextMinute(Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [now]);
  const face = clockFace(now);
  // Redrawing the face invalidates once, which also renders the new hand angles.
  const texture = useCanvasTexture(TEX, TEX, ctx => drawFace(ctx, face.text, receipts), [face.text, receipts]);
  return <group name='prop:clock' position={[-7.9, 1.75, 0.6]} rotation={[0, Math.PI / 2, 0]}>
    <mesh position={[0, -RADIUS - 0.1, -0.02]} receiveShadow>
      <boxGeometry args={[0.06, 0.3, 0.04]} /><meshStandardMaterial color='#5a6156' />
    </mesh>
    <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
      <cylinderGeometry args={[RADIUS, RADIUS, 0.08, 32]} /><meshStandardMaterial color='#3c4d47' roughness={0.7} />
    </mesh>
    <mesh position={[0, 0, 0.041]} receiveShadow>
      <circleGeometry args={[RADIUS - 0.04, 32]} />
      <meshStandardMaterial map={texture} emissiveMap={texture} emissive='#ffffff' emissiveIntensity={0.3} roughness={1} />
    </mesh>
    <Hand angle={face.hourAngle} length={0.2} width={0.035} z={0.05} />
    <Hand angle={face.minuteAngle} length={0.3} width={0.022} z={0.058} />
  </group>;
}

/** Left-wall clock above the Lobby/Collections aisle, facing +x. */
export function WallClock({ snapshot }: { snapshot: OfficeSnapshot }) {
  return CLOCK_INTERACTION.visible(snapshot) ? <Clock receipts={snapshot.audit.length} /> : null;
}
