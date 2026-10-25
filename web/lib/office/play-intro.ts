/** Pure camera interpolation. The intro is visual only; Play owns the input handoff. */
import { easeInOutCubic } from './tour';

export const PLAY_INTRO_MS = 900;
export type Quaternion = readonly [x: number, y: number, z: number, w: number];
export interface IntroPose {
  readonly position: readonly [x: number, y: number, z: number];
  readonly quaternion: Quaternion;
}

export function playIntroProgress(elapsedMs: number, reduced: boolean): number {
  return reduced ? 1 : easeInOutCubic(elapsedMs / PLAY_INTRO_MS);
}

/** Unit quaternions use the same hemisphere so yaw crossing +/-PI takes the short arc. */
export function interpolateQuaternion(from: Quaternion, to: Quaternion, progress: number): Quaternion {
  const t = Math.min(1, Math.max(0, progress));
  const dot = from.reduce((sum, value, i) => sum + value * to[i]!, 0);
  const sign = dot < 0 ? -1 : 1;
  const cosine = Math.min(1, Math.abs(dot));
  const angle = Math.acos(cosine);
  const sine = Math.sin(angle);
  const a = cosine > 0.9995 ? 1 - t : Math.sin((1 - t) * angle) / sine;
  const b = (cosine > 0.9995 ? t : Math.sin(t * angle) / sine) * sign;
  const result = from.map((value, i) => value * a + to[i]! * b);
  const length = Math.hypot(...result);
  return [result[0]! / length, result[1]! / length, result[2]! / length, result[3]! / length];
}

export function interpolateIntroPose(from: IntroPose, to: IntroPose, progress: number): IntroPose {
  const t = Math.min(1, Math.max(0, progress));
  if (t === 0) return from;
  if (t === 1) return to;
  return {
    position: [
      from.position[0] + (to.position[0] - from.position[0]) * t,
      from.position[1] + (to.position[1] - from.position[1]) * t,
      from.position[2] + (to.position[2] - from.position[2]) * t,
    ],
    quaternion: interpolateQuaternion(from.quaternion, to.quaternion, t),
  };
}
