'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, CanvasTexture, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace, SphereGeometry, type Group, type Material } from 'three';
import {
  BEAR, BEAR_CARRY_FRONT, BEAR_CARRY_PAW, CAL_BLUE, CAL_GOLD, armSwing, bearIdle, bearPalette, bearPhase, type ArmPose,
} from '../../../lib/office/bear';
import { AvatarAnchors } from './AvatarAnchors';
import { legSwing } from '../../../lib/office/a11y';
import { useReducedMotion } from '../mounts/shared';

// Shared by every bear: two unit geometries scaled per part and one material per colour.
const BOX = new BoxGeometry(1, 1, 1);
const BALL = new SphereGeometry(0.5, 8, 6);
const BADGE = new PlaneGeometry(BEAR.badge.size[0], BEAR.badge.size[1]);
const materials = new Map<string, MeshStandardMaterial>();
function fur(color: string): MeshStandardMaterial {
  let material = materials.get(color);
  if (!material) materials.set(color, material = new MeshStandardMaterial({ color, roughness: 0.85, flatShading: true }));
  return material;
}
let badge: MeshStandardMaterial | undefined;
/** Gold "C" on a Cal blue disc, drawn once on a tiny canvas shared by all bears. */
function badgeMaterial(): MeshStandardMaterial {
  if (badge) return badge;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = CAL_GOLD;
    ctx.beginPath(); ctx.arc(32, 32, 31, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CAL_BLUE;
    ctx.beginPath(); ctx.arc(32, 32, 27, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CAL_GOLD;
    ctx.font = '700 42px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('C', 32, 35);
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  return badge = new MeshStandardMaterial({ map, roughness: 0.6 });
}

export type BearCarry = 'none' | 'paw' | 'front';
/** Pivots a parent's useFrame poses with poseBear; `carry` holds the arms instead of swinging them. */
export interface BearRig {
  legs: Group | null; arms: Group | null; head: Group | null; chest: Group | null; carry: BearCarry;
  /** The whole bear (bob, lean, sway). */
  root?: Group | null;
  /** Set by an AgentAnimator, which then owns the head, chest and root; the built-in idle stands down. */
  driven?: boolean;
}
export function createBearRig(): BearRig {
  return { legs: null, arms: null, head: null, chest: null, carry: 'none', root: null, driven: false };
}
function holdArm(arm: { rotation: { x: number; z: number } }, side: number, pose: ArmPose) {
  arm.rotation.x = pose.pitch;
  arm.rotation.z = -side * pose.tuck;
}
/** Walk pose for the frame being rendered (call from the owner's useFrame). */
export function poseBear(rig: BearRig, distance: number, moving: boolean, reduced: boolean) {
  rig.legs?.children.forEach((leg, i) => { leg.rotation.x = legSwing(distance, i, moving, reduced); });
  rig.arms?.children.forEach((arm, i) => {
    const side = i === 0 ? -1 : 1;
    if (rig.carry === 'front') holdArm(arm, side, BEAR_CARRY_FRONT);
    else if (rig.carry === 'paw' && side === 1) holdArm(arm, side, BEAR_CARRY_PAW);
    else { arm.rotation.x = armSwing(distance, i, moving, reduced); arm.rotation.z = 0; }
  });
}

type Vec3 = readonly [number, number, number];
/** dispose={null}: geometry and materials are shared, so unmounting one bear must not free them. */
function Part({ at, size, radius, material, shadow }: { at: Vec3; size?: Vec3; radius?: number; material: Material; shadow?: boolean }) {
  const scale: Vec3 = size ?? [radius! * 2, radius! * 2, radius! * 2];
  return <mesh position={at as [number, number, number]} scale={scale as [number, number, number]} geometry={size ? BOX : BALL} material={material}
    castShadow={shadow} dispose={null} />;
}
const mirror = (at: Vec3, side: number): Vec3 => [at[0] * side, at[1], at[2]];
const SIDES = [-1, 1] as const;

/**
 * Low-poly agent bear (the Cal Hacks mascot), tinted by the role accent, about 1.6 m tall like the
 * old avatars. Draws only; the owner positions the root and calls poseBear. A subtle idle runs on
 * frames that are already rendering and never requests one. `ghost` draws every part in one
 * material (the Treasury DENY echo). `paw` is attached to the right paw. Leave `carry` unset when the
 * owner's useFrame sets `rig.carry` itself.
 */
export function Bear({ color, seed, rig: external, carry, ghost, paw }: {
  color: string; seed: string; rig?: BearRig; carry?: BearCarry; ghost?: Material; paw?: ReactNode;
}) {
  const reduced = useReducedMotion();
  const [own] = useState(createBearRig);
  const rig = external ?? own;
  if (carry) rig.carry = carry;
  const phase = useMemo(() => bearPhase(seed), [seed]);
  const look = useMemo(() => {
    const palette = bearPalette(color);
    return ghost
      ? { fur: ghost, muzzle: ghost, nose: ghost, scarf: ghost, badge: null }
      : { fur: fur(palette.fur), muzzle: fur(palette.muzzle), nose: fur(palette.nose), scarf: fur(palette.scarf), badge: badgeMaterial() };
  }, [color, ghost]);
  const shadow = !ghost;
  useFrame(state => {
    if (rig.driven) return;
    const idle = bearIdle(state.clock.elapsedTime, phase, reduced);
    if (rig.head) { rig.head.rotation.z = idle.tilt; rig.head.rotation.x = idle.nod; }
    if (rig.chest) { rig.chest.scale.x = 1 + idle.breath; rig.chest.scale.z = 1 + idle.breath; }
  });
  return <group name='bear' ref={group => { rig.root = group; }}>
    {rig.driven && <AvatarAnchors rig={rig} />}
    <group ref={group => { rig.chest = group; }}>
      <Part {...BEAR.torso} material={look.fur} shadow={shadow} />
      <Part {...BEAR.belly} material={look.muzzle} />
      <Part {...BEAR.scarf} material={look.scarf} shadow={shadow} />
      <Part {...BEAR.scarfTail} material={look.scarf} />
      {look.badge && <mesh position={[BEAR.badge.at[0], BEAR.badge.at[1], BEAR.badge.at[2]]} geometry={BADGE} material={look.badge} dispose={null} />}
    </group>
    <group position={[0, BEAR.neck, 0]} ref={group => { rig.head = group; }}>
      <Part {...BEAR.head} material={look.fur} shadow={shadow} />
      <Part {...BEAR.muzzle} material={look.muzzle} />
      <Part {...BEAR.nose} material={look.nose} />
      {SIDES.map(side => <group key={side}>
        <Part at={mirror(BEAR.ear.at, side)} radius={BEAR.ear.radius} material={look.fur} shadow={shadow} />
        <Part at={mirror(BEAR.innerEar.at, side)} radius={BEAR.innerEar.radius} material={look.muzzle} />
        <Part at={mirror(BEAR.eye.at, side)} size={BEAR.eye.size} material={look.nose} />
      </group>)}
    </group>
    <group ref={group => { rig.arms = group; }}>{SIDES.map(side => <group key={side} position={[side * BEAR.shoulder.x, BEAR.shoulder.y, 0]}>
      <Part {...BEAR.arm} material={look.fur} shadow={shadow} />
      <Part at={BEAR.paw.at} radius={BEAR.paw.radius} material={look.muzzle} />
      {side === 1 && paw && <group position={[BEAR.paw.at[0], BEAR.paw.at[1], BEAR.paw.at[2]]}>{paw}</group>}
    </group>)}</group>
    <group ref={group => { rig.legs = group; }}>{SIDES.map(side => <group key={side} position={[side * BEAR.leg.x, BEAR.hip, 0]}>
      <Part at={[0, -BEAR.leg.part.size[1] / 4, 0]}
        size={[BEAR.leg.part.size[0], BEAR.leg.part.size[1] / 2, BEAR.leg.part.size[2]]} material={look.fur} shadow={shadow} />
      <group name='shin' position={[0, -BEAR.leg.part.size[1] / 2, 0]}>
        <Part at={[0, -BEAR.leg.part.size[1] / 4, 0]}
          size={[BEAR.leg.part.size[0], BEAR.leg.part.size[1] / 2, BEAR.leg.part.size[2]]} material={look.fur} shadow={shadow} />
        <Part at={[BEAR.foot.at[0], BEAR.foot.at[1] + BEAR.leg.part.size[1] / 2, BEAR.foot.at[2]]}
          size={BEAR.foot.size} material={look.muzzle} shadow={shadow} />
      </group>
    </group>)}</group>
  </group>;
}
