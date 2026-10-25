'use client';

import { useState } from 'react';
import type { Camera } from 'three';
import { createHeadBob, headBob } from '../../../lib/office/immersive/bob';
import { LOOK_SETTLE, lookDampFraction } from '../../../lib/office/immersive/look';
import { immersiveChannel } from './channel';

/**
 * Per-rig immersive state: damped mouse/touch look and the camera pose with head bob and sway.
 * Mutates its own fields only, so the rig can call it every frame without allocating.
 */
export class ImmersiveRig {
  /** Look to apply this frame (radians), after damping. */
  yaw = 0;
  pitch = 0;
  private pendingYaw = 0;
  private pendingPitch = 0;
  private readonly bob = createHeadBob();

  /** Adds this frame's raw look and takes the damped share of everything still pending. */
  damp(rawYaw: number, rawPitch: number, dt: number, smoothing: boolean): void {
    this.pendingYaw += rawYaw || 0;
    this.pendingPitch += rawPitch || 0;
    const share = lookDampFraction(dt, smoothing);
    const yaw = Math.abs(this.pendingYaw) < LOOK_SETTLE ? this.pendingYaw : this.pendingYaw * share;
    const pitch = Math.abs(this.pendingPitch) < LOOK_SETTLE ? this.pendingPitch : this.pendingPitch * share;
    this.pendingYaw -= yaw; this.pendingPitch -= pitch;
    this.yaw = yaw; this.pitch = pitch;
  }
  /** Drops pending look (intro, dialogs). */
  reset(): void { this.pendingYaw = 0; this.pendingPitch = 0; this.yaw = 0; this.pitch = 0; }
  /** True while damped look is still arriving, so the scene keeps rendering frames. */
  get settling(): boolean { return this.pendingYaw !== 0 || this.pendingPitch !== 0; }

  /** Places the eye at (x, eyeY, z) plus the bob sway for `distance` walked at bob `intensity` (0 when bob is off). */
  pose(camera: Camera, x: number, eyeY: number, z: number, yaw: number, pitch: number, distance: number, intensity: number): void {
    const bob = headBob(distance, intensity, this.bob);
    // Sway along the camera's right vector (yaw 0 looks toward -z, so right is +x).
    camera.position.set(x + Math.cos(yaw) * bob.x, eyeY, z - Math.sin(yaw) * bob.x);
    camera.rotation.set(pitch, yaw, bob.roll, 'YXZ');
    camera.updateMatrixWorld();
  }

  /** Records the speed of a footfall for the floor-aware footstep sound. */
  step(speed: number): void { immersiveChannel.speed = Number.isFinite(speed) ? speed : 0; }
}

export function useImmersiveRig(): ImmersiveRig {
  const [rig] = useState(() => new ImmersiveRig());
  return rig;
}
