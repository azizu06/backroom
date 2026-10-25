/**
 * Pure head-bob curve for first person. The vertical dip comes from ../playFeel (`bobHeight`, one dip per
 * footfall); this adds the matching side-to-side sway and a hint of roll (one sway cycle per two steps).
 * `intensity` is the smoothed bob amplitude (0..1.5), already 0 when head bob is off or motion is reduced.
 */
import { STEP_DISTANCE, bobHeight } from '../playFeel';

/** Metres of sideways sway at full walking speed. */
export const SWAY_AMPLITUDE = 0.012;
/** Radians of camera roll at full walking speed (about 0.3°). */
export const ROLL_AMPLITUDE = 0.005;

export interface HeadBob { y: number; x: number; roll: number }
export function createHeadBob(): HeadBob { return { y: 0, x: 0, roll: 0 }; }

function level(intensity: number) { return Number.isFinite(intensity) ? Math.min(1.5, Math.max(0, intensity)) : 0; }

/** Writes the bob offsets for `distance` walked into `out` (no allocation; the rig calls this every frame). */
export function headBob(distance: number, intensity: number, out: HeadBob): HeadBob {
  const amount = level(intensity);
  const phase = Number.isFinite(distance) ? Math.PI * distance / STEP_DISTANCE : 0;
  const side = Math.sin(phase);
  out.y = bobHeight(Number.isFinite(distance) ? distance : 0, amount);
  out.x = SWAY_AMPLITUDE * amount * side || 0;
  out.roll = ROLL_AMPLITUDE * amount * side || 0;
  return out;
}
