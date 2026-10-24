'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MeshBasicMaterial, MeshStandardMaterial, type Group } from 'three';
import { matchingDenial, type OfficeSnapshot } from '../../../lib/office/state';
import { DENY_MOMENT_MS, TREASURY_DOOR, TREASURY_DOOR_INTERACTION, createDenyPose, denyPose, denyReceipt, type DenyReceipt } from '../../../lib/office/props/treasuryDeny';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';
import { useReducedMotion } from './useReducedMotion';

const DENY_RED = '#ed6252', RING_Z = 1.27, RING_MAX = 2.4;
const SIGN_W = 1.4, SIGN_H = 0.32, SIGN_Y = 1.6, TEX_W = 512, TEX_H = Math.round(TEX_W * SIGN_H / SIGN_W);
const RING: readonly { at: [number, number, number]; size: [number, number, number] }[] = [
  { at: [0, 1.12, 0], size: [1.66, 0.08, 0.04] },
  { at: [0, 0.04, 0], size: [1.66, 0.05, 0.04] },
  { at: [-0.79, 0.58, 0], size: [0.08, 1.1, 0.04] },
  { at: [0.79, 0.58, 0], size: [0.08, 1.1, 0.04] },
];

function drawSign(ctx: CanvasRenderingContext2D, text: string) {
  ctx.fillStyle = DENY_RED;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 44;
  ctx.font = `700 ${size}px ${PROP_FONT}`;
  while (size > 18 && ctx.measureText(text).width > TEX_W - 32) ctx.font = `700 ${--size}px ${PROP_FONT}`;
  ctx.fillText(text, TEX_W / 2, TEX_H / 2 + 2);
}

/** One played moment for one DENY receipt; unmounts (via onEnd) when it is over. */
function Moment({ receipt, at, reduced, onEnd }: { receipt: DenyReceipt; at: number; reduced: boolean; onEnd: () => void }) {
  const invalidate = useThree(state => state.invalidate);
  const root = useRef<Group>(null);
  const echo = useRef<Group>(null);
  const pose = useRef(createDenyPose());
  const ended = useRef(false);
  const [ring] = useState(() => new MeshStandardMaterial({ color: DENY_RED, emissive: DENY_RED, emissiveIntensity: 0, roughness: 0.6 }));
  const [sign] = useState(() => new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  const [cord] = useState(() => new MeshBasicMaterial({ color: '#3c342e', transparent: true, opacity: 0, depthWrite: false }));
  const [ghost] = useState(() => new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => drawSign(ctx, receipt.signText), [receipt.signText]);
  useEffect(() => { sign.map = texture; sign.needsUpdate = true; }, [sign, texture]);
  useEffect(() => { ghost.color.set(receipt.color); }, [ghost, receipt.color]);
  useEffect(() => () => { ring.dispose(); sign.dispose(); cord.dispose(); ghost.dispose(); }, [ring, sign, cord, ghost]);
  useEffect(() => { invalidate(); }, [receipt.auditId, invalidate]);
  useFrame(state => {
    if (ended.current || !root.current) return;
    // Ages clamp at 0 inside denyPose: clock skew can put a row's `at` ahead of this clock.
    const age = Date.now() - at;
    if (age >= DENY_MOMENT_MS) {
      ended.current = true;
      root.current.visible = false;
      onEnd();
      return;
    }
    const current = denyPose(age, reduced, pose.current);
    root.current.visible = true;
    ring.emissiveIntensity = RING_MAX * current.pulse;
    sign.opacity = current.signOpacity;
    cord.opacity = current.signOpacity;
    ghost.opacity = current.echo.opacity;
    if (echo.current) {
      echo.current.position.set(current.echo.x, 0, current.echo.z);
      echo.current.rotation.y = current.echo.heading;
    }
    state.invalidate();
  });
  const [x] = TREASURY_DOOR;
  return <group ref={root} name='prop:treasury-deny' visible={false}>
    <group position={[x, 0, RING_Z]}>
      {RING.map(({ at: position, size }, i) => <mesh key={i} position={position} material={ring}><boxGeometry args={size} /></mesh>)}
      {[-0.5, 0.5].map(side => <mesh key={side} position={[side, SIGN_Y + SIGN_H / 2 + 0.16, 0]} material={cord}><boxGeometry args={[0.02, 0.32, 0.02]} /></mesh>)}
      <mesh position={[0, SIGN_Y, 0.02]} material={sign}><planeGeometry args={[SIGN_W, SIGN_H]} /></mesh>
    </group>
    <group ref={echo}>
      <mesh position={[0, 0.83, 0]} material={ghost}><boxGeometry args={[0.43, 0.6, 0.28]} /></mesh>
      <mesh position={[0, 1.3, 0]} material={ghost}><boxGeometry args={[0.34, 0.36, 0.32]} /></mesh>
      <mesh position={[0, 0.3, 0]} material={ghost}><boxGeometry args={[0.36, 0.55, 0.22]} /></mesh>
    </group>
  </group>;
}

/**
 * Treasury door DENY moment, layered over the existing door flash. Plays only for the server's
 * matching DENY receipt, renders on demand while active and nothing once the moment is over.
 */
export function TreasuryDeny({ snapshot }: { snapshot: OfficeSnapshot }) {
  const reduced = useReducedMotion();
  const [endedId, setEndedId] = useState<string | null>(null);
  const denial = TREASURY_DOOR_INTERACTION.visible(snapshot) ? matchingDenial(snapshot, 'treasury') : undefined;
  const receipt = denial ? denyReceipt(snapshot) : null;
  if (!denial || !receipt || endedId === denial.auditId) return null;
  const auditId = denial.auditId;
  return <Moment key={auditId} receipt={receipt} at={denial.at} reduced={reduced} onEnd={() => setEndedId(auditId)} />;
}
