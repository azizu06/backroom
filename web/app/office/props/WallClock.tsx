'use client';

import { useEffect, useState } from 'react';
import type { OfficeSnapshot } from '../../../lib/office/state';
import { CLOCK_INTERACTION, clockFace, msUntilNextMinute } from '../../../lib/office/props/clock';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';
import { ROLES } from '../../../lib/office/palette';

const RADIUS = 0.65, FACE = RADIUS - 0.04, TEX = 512;
const FACE_UNITS = 256;
const HAND_BACK = 0.03;
const MINUTE_LENGTH = FACE * 0.74, HOUR_LENGTH = MINUTE_LENGTH * 0.68;

function drawFace(ctx: CanvasRenderingContext2D) {
  ctx.scale(TEX / FACE_UNITS, TEX / FACE_UNITS);
  const c = FACE_UNITS / 2;
  ctx.fillStyle = ROLES.wall;
  ctx.beginPath();
  ctx.arc(c, c, c, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ROLES.text;
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    if (i % 3 === 0) continue;
    const angle = i * Math.PI / 6;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(c + Math.sin(angle) * (c - 20), c - Math.cos(angle) * (c - 20));
    ctx.lineTo(c + Math.sin(angle) * (c - 10), c - Math.cos(angle) * (c - 10));
    ctx.stroke();
  }
  ctx.fillStyle = ROLES.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 70px ${PROP_FONT}`;
  for (const [text, x, y] of [['12', c, 42], ['3', 216, c], ['6', c, 216], ['9', 40, c]] as const) ctx.fillText(text, x, y);
}

function Hand({ angle, length, width, z }: { angle: number; length: number; width: number; z: number }) {
  return <group rotation={[0, 0, -angle]} position={[0, 0, z]}>
    <mesh position={[0, length / 2 - HAND_BACK, 0]} receiveShadow>
      <boxGeometry args={[width, length, 0.012]} /><meshStandardMaterial color={ROLES.text} />
    </mesh>
  </group>;
}

function Clock() {
  const [now, setNow] = useState(() => Date.now());
  // One state change per minute, aligned to the boundary; no frame loop and no second hand (same under reduced motion).
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), msUntilNextMinute(Date.now()) + 20);
    return () => clearTimeout(timer);
  }, [now]);
  const face = clockFace(now);
  // Redrawing the face invalidates once, which also renders the new hand angles.
  const texture = useCanvasTexture(TEX, TEX, drawFace, [face.text]);
  return <group name='prop:clock' position={[-7.9, 1.75, 0.6]}>
    <mesh position={[0.26, 0, 0]} receiveShadow>
      <boxGeometry args={[0.52, 0.08, 0.08]} /><meshStandardMaterial color={ROLES.shadow} />
    </mesh>
    {/* Fixed wall bracket with a tilted face; its normal follows the overview's (13, 15, 17) direction. */}
    <group position={[0.52, 0, 0]} rotation={[-Math.atan2(15, Math.hypot(13, 17)), Math.atan2(13, 17), 0, 'YXZ']}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[RADIUS, RADIUS, 0.08, 32]} /><meshStandardMaterial color={ROLES.partition} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.041]} receiveShadow>
        <circleGeometry args={[FACE, 32]} />
        <meshStandardMaterial map={texture} emissiveMap={texture} emissive={ROLES.wall} emissiveIntensity={0.3} roughness={1} />
      </mesh>
      <Hand angle={face.hourAngle} length={HOUR_LENGTH} width={0.035} z={0.05} />
      <Hand angle={face.minuteAngle} length={MINUTE_LENGTH} width={0.022} z={0.058} />
    </group>
  </group>;
}

/** Left-wall clock on a fixed bracket, angled toward overview. Exact time and receipts remain in its panel. */
export function WallClock({ snapshot }: { snapshot: OfficeSnapshot }) {
  return CLOCK_INTERACTION.visible(snapshot) ? <Clock /> : null;
}
