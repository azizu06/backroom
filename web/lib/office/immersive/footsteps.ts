/**
 * Pure footstep cadence and timbre. Steps fall once per `STEP_DISTANCE` walked (see ../playFeel), so the
 * cadence follows the speed; the floor under the player picks the sound. Audio only.
 */
import { REFERENCE_SPEED, STEP_DISTANCE } from '../playFeel';

export type FloorType = 'carpet' | 'wood' | 'tile' | 'grass';

/** Footfalls per second at `speed` m/s; 0 when standing. */
export function footstepCadence(speed: number): number {
  return Number.isFinite(speed) && speed > 0 ? speed / STEP_DISTANCE : 0;
}
/** Seconds between footfalls at `speed`; Infinity when standing. */
export function footstepInterval(speed: number): number {
  const cadence = footstepCadence(speed);
  return cadence > 0 ? 1 / cadence : Infinity;
}
/** Loudness 0.55..1: a slow shuffle is quieter than a full walk; faster than walking stays at 1. */
export function footstepLevel(speed: number): number {
  const ratio = Number.isFinite(speed) ? Math.min(1, Math.max(0, speed / REFERENCE_SPEED)) : 0;
  return 0.55 + 0.45 * ratio;
}

export interface FootstepVoice {
  /** Low "body" thump: start and end pitch (Hz) and decay (s). */
  readonly bodyHz: number; readonly bodyEndHz: number; readonly bodyDecay: number; readonly bodyGain: number;
  /** Heel click (Hz, s): hard floors only; 0 gain for soft ones. */
  readonly clickHz: number; readonly clickDecay: number; readonly clickGain: number;
  /** Filtered noise: scuff or rustle. */
  readonly noiseFilter: 'lowpass' | 'bandpass' | 'highpass'; readonly noiseHz: number; readonly noiseQ: number;
  readonly noiseDecay: number; readonly noiseGain: number;
}

/** Carpet is a muffled thud, wood a hollow knock, tile a hard click, grass a soft rustle. */
export const FOOTSTEP_VOICES: Readonly<Record<FloorType, FootstepVoice>> = {
  carpet: { bodyHz: 90, bodyEndHz: 60, bodyDecay: 0.09, bodyGain: 0.7, clickHz: 900, clickDecay: 0.015, clickGain: 0.04,
    noiseFilter: 'lowpass', noiseHz: 500, noiseQ: 0.7, noiseDecay: 0.08, noiseGain: 0.35 },
  wood: { bodyHz: 150, bodyEndHz: 95, bodyDecay: 0.11, bodyGain: 0.6, clickHz: 1300, clickDecay: 0.025, clickGain: 0.18,
    noiseFilter: 'bandpass', noiseHz: 900, noiseQ: 1.2, noiseDecay: 0.05, noiseGain: 0.25 },
  tile: { bodyHz: 210, bodyEndHz: 140, bodyDecay: 0.06, bodyGain: 0.45, clickHz: 2600, clickDecay: 0.03, clickGain: 0.3,
    noiseFilter: 'highpass', noiseHz: 2800, noiseQ: 0.8, noiseDecay: 0.04, noiseGain: 0.3 },
  grass: { bodyHz: 70, bodyEndHz: 50, bodyDecay: 0.07, bodyGain: 0.25, clickHz: 0, clickDecay: 0, clickGain: 0,
    noiseFilter: 'bandpass', noiseHz: 3200, noiseQ: 0.6, noiseDecay: 0.16, noiseGain: 0.6 },
};
export function footstepVoice(floor: FloorType): FootstepVoice { return FOOTSTEP_VOICES[floor] ?? FOOTSTEP_VOICES.wood; }
