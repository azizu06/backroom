'use client';

import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { MeshBasicMaterial, MeshStandardMaterial, type Group } from 'three';
import { matchingDenial, type OfficeSnapshot } from '../../../lib/office/state';
import { DENY_MOMENT_MS, ECHO_START, ECHO_WALK, TREASURY_DOOR, TREASURY_DOOR_INTERACTION, createDenyPose, denyPose, denyReceipt, type DenyReceipt } from '../../../lib/office/props/treasuryDeny';
import { Bear, createBearRig, poseBear } from '../avatars/Bear';
import { PROP_FONT, useCanvasTexture } from './useCanvasTexture';
import { useReducedMotion } from './useReducedMotion';

const DENY_RED = '#ed6252', RING_MAX = 2.4;
// Frame just outside scene.tsx's door flash box (1.5 x 1.3 x 0.2 at (5, 0.65, 1.15), front face z 1.25).
const RING_Z = 1.275, RING_T = 0.08, RING_D = 0.04, OPEN_W = 1.6, OPEN_H = 1.4;
const RING: readonly { at: [number, number, number]; size: [number, number, number] }[] = [
  { at: [0, OPEN_H + RING_T / 2, 0], size: [OPEN_W + RING_T * 2, RING_T, RING_D] },
  { at: [0, 0.025, 0], size: [OPEN_W + RING_T * 2, 0.05, RING_D] },
  { at: [-(OPEN_W + RING_T) / 2, OPEN_H / 2, 0], size: [RING_T, OPEN_H, RING_D] },
  { at: [(OPEN_W + RING_T) / 2, OPEN_H / 2, 0], size: [RING_T, OPEN_H, RING_D] },
];
// Free-standing sign on the aisle side of the door, right of the doorway and below the room label; faces +z.
const SIGN_POS: [number, number, number] = [6.35, 0, 0.55];
const SIGN_W = 1.6, SIGN_H = 0.72, SIGN_Y = 1.1, TEX_W = 512, TEX_H = Math.round(TEX_W * SIGN_H / SIGN_W);

function fitFont(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number) {
  ctx.font = `700 ${size}px ${PROP_FONT}`;
  while (size > 18 && ctx.measureText(text).width > maxWidth) ctx.font = `700 ${--size}px ${PROP_FONT}`;
}

function drawSign(ctx: CanvasRenderingContext2D, text: string) {
  const [head = text, ...rest] = text.split(' · ');
  const rule = rest.join(' · ');
  ctx.fillStyle = DENY_RED;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, TEX_W - 20, TEX_H - 20);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (!rule) { fitFont(ctx, head, 96, TEX_W - 48); ctx.fillText(head, TEX_W / 2, TEX_H / 2 + 4); return; }
  fitFont(ctx, head, 84, TEX_W - 48);
  ctx.fillText(head, TEX_W / 2, TEX_H * 0.36);
  fitFont(ctx, rule, 68, TEX_W - 40);
  ctx.fillText(rule, TEX_W / 2, TEX_H * 0.72);
}

/** One played moment for one DENY receipt; unmounts (via onEnd) when it is over. */
function Moment({ receipt, at, reduced, onEnd }: { receipt: DenyReceipt; at: number; reduced: boolean; onEnd: (auditId: string) => void }) {
  const invalidate = useThree(state => state.invalidate);
  const root = useRef<Group>(null);
  const echo = useRef<Group>(null);
  const pose = useRef(createDenyPose());
  const [echoRig] = useState(createBearRig);
  const ended = useRef(false);
  const [ring] = useState(() => new MeshStandardMaterial({ color: DENY_RED, emissive: DENY_RED, emissiveIntensity: 0, roughness: 0.6 }));
  const [sign] = useState(() => new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  const [post] = useState(() => new MeshBasicMaterial({ color: '#3c342e', transparent: true, opacity: 0, depthWrite: false }));
  const [ghost] = useState(() => new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  const texture = useCanvasTexture(TEX_W, TEX_H, ctx => drawSign(ctx, receipt.signText), [receipt.signText]);
  useEffect(() => { sign.map = texture; sign.needsUpdate = true; }, [sign, texture]);
  useEffect(() => { ghost.color.set(receipt.color); }, [ghost, receipt.color]);
  useEffect(() => () => { ring.dispose(); sign.dispose(); post.dispose(); ghost.dispose(); }, [ring, sign, post, ghost]);
  useEffect(() => { invalidate(); }, [receipt.auditId, reduced, invalidate]);
  // Reduced motion holds one pose: render it once, then end on a timer instead of redrawing every frame.
  useEffect(() => {
    if (!reduced) return;
    const timer = setTimeout(() => {
      ended.current = true;
      if (root.current) root.current.visible = false;
      onEnd(receipt.auditId);
      invalidate();
    }, Math.max(0, DENY_MOMENT_MS - (Date.now() - at)));
    return () => clearTimeout(timer);
  }, [reduced, at, onEnd, invalidate, receipt.auditId]);
  useFrame(state => {
    if (ended.current || !root.current) return;
    // Ages clamp at 0 inside denyPose: clock skew can put a row's `at` ahead of this clock.
    const age = Date.now() - at;
    if (age >= DENY_MOMENT_MS) {
      if (reduced) return;
      ended.current = true;
      root.current.visible = false;
      onEnd(receipt.auditId);
      return;
    }
    const current = denyPose(age, reduced, pose.current);
    root.current.visible = true;
    ring.emissiveIntensity = RING_MAX * current.pulse;
    sign.opacity = current.signOpacity;
    post.opacity = current.signOpacity;
    ghost.opacity = current.echo.opacity;
    if (echo.current) {
      echo.current.position.set(current.echo.x, 0, current.echo.z);
      echo.current.rotation.y = current.echo.heading;
      const walked = ECHO_START[1] - current.echo.z;
      poseBear(echoRig, walked, walked > 1e-6 && walked < ECHO_WALK - 1e-6, reduced);
    }
    if (!reduced) state.invalidate();
  });
  const [x] = TREASURY_DOOR;
  return <group ref={root} name='prop:treasury-deny' visible={false}>
    <group position={[x, 0, RING_Z]}>
      {RING.map(({ at: position, size }, i) => <mesh key={i} position={position} material={ring}><boxGeometry args={size} /></mesh>)}
    </group>
    <group position={SIGN_POS}>
      <mesh position={[0, (SIGN_Y - SIGN_H / 2) / 2, -0.03]} material={post}><boxGeometry args={[0.07, SIGN_Y - SIGN_H / 2, 0.05]} /></mesh>
      <mesh position={[0, 0.02, -0.03]} material={post}><boxGeometry args={[0.36, 0.04, 0.26]} /></mesh>
      <mesh position={[0, SIGN_Y, -0.02]} material={post}><boxGeometry args={[SIGN_W + 0.06, SIGN_H + 0.06, 0.03]} /></mesh>
      <mesh position={[0, SIGN_Y, 0]} material={sign}><planeGeometry args={[SIGN_W, SIGN_H]} /></mesh>
    </group>
    {/* The denied agent's translucent bear turns away from the door. */}
    <group ref={echo}><Bear color={receipt.color} seed={receipt.agentId} rig={echoRig} ghost={ghost} /></group>
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
  return <Moment key={denial.auditId} receipt={receipt} at={denial.at} reduced={reduced} onEnd={setEndedId} />;
}
