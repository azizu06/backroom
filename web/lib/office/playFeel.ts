/**
 * Pure "game feel" maths for first-person Play: acceleration and friction, head-bob phase, a subtle FOV kick,
 * footstep timing and the crosshair state. Visual and audio only; nothing here reads or writes office state.
 * No imports from ./play or ./playSettings so both can depend on it.
 */

/** Which feel effects are on. All of them are forced off under prefers-reduced-motion (see `effectiveFeel`). */
export interface FeelFlags { readonly smoothing: boolean; readonly bob: boolean; readonly fovKick: boolean }
export const DEFAULT_FEEL: FeelFlags = { smoothing: true, bob: true, fovKick: true };
export const NO_FEEL: FeelFlags = { smoothing: false, bob: false, fovKick: false };

/** Reduced motion wins over the viewer's settings: no smoothing, no bob, no FOV change. */
export function effectiveFeel(flags: FeelFlags, reducedMotion: boolean): FeelFlags {
  return reducedMotion ? NO_FEEL : flags;
}

/** m/s². Full walk speed in about 0.1 s: weighted, not floaty. */
export const ACCELERATION = 30;
/** m/s². From full speed to rest in about 0.07 s (about 0.1 m), so you stop where you let go. */
export const FRICTION = 45;
/** Walking speed the bob amplitude and FOV kick are normalised against (matches `WALK_SPEED` in ./play). */
export const REFERENCE_SPEED = 3;
/** First-person vertical field of view in degrees. */
export const BASE_FOV = 75;
/** Degrees added at full walking speed. Subtle on purpose. */
export const FOV_KICK = 3.5;
/** Metres of the eye bobbing up and down at full walking speed. */
export const BOB_AMPLITUDE = 0.03;
/** Metres per footstep; the bob dips once per step, on the footfall. */
export const STEP_DISTANCE = 0.9;
/** 1 / seconds: how quickly the bob amplitude and FOV chase their targets. */
export const FEEL_RATE = 9;

export type Vec2 = readonly [number, number];

/**
 * One velocity step toward `wish` (m/s). While a direction is held the velocity closes on it at
 * `ACCELERATION`; with nothing held it slows at `FRICTION` and stops exactly at zero. With smoothing off the
 * velocity snaps to `wish`. Non-finite or non-positive `dt` leaves the velocity unchanged.
 */
export function integrateVelocity(velocity: Vec2, wish: Vec2, dt: number, smoothing = true): [number, number] {
  if (!Number.isFinite(dt) || dt <= 0) return [velocity[0], velocity[1]];
  if (!smoothing) return [wish[0], wish[1]];
  const wishSpeed = Math.hypot(wish[0], wish[1]);
  if (wishSpeed > 1e-9) {
    const dx = wish[0] - velocity[0], dz = wish[1] - velocity[1];
    const gap = Math.hypot(dx, dz), reach = ACCELERATION * dt;
    if (gap <= reach) return [wish[0], wish[1]];
    return [velocity[0] + dx / gap * reach, velocity[1] + dz / gap * reach];
  }
  const speed = Math.hypot(velocity[0], velocity[1]);
  const slowed = Math.max(0, speed - FRICTION * dt);
  if (speed < 1e-9 || slowed === 0) return [0, 0];
  const scale = slowed / speed;
  return [velocity[0] * scale, velocity[1] * scale];
}

/** Exponential approach, stable for any `dt`. */
export function approach(current: number, target: number, dt: number, rate = FEEL_RATE): number {
  if (!Number.isFinite(dt) || dt <= 0) return current;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Footfall progress in steps: 1 per `STEP_DISTANCE` walked. */
export function stridePhase(distance: number): number { return distance / STEP_DISTANCE; }

/** Eye height offset in metres. The lowest point is the footfall (whole steps); `intensity` is 0..1. */
export function bobHeight(distance: number, intensity: number): number {
  const level = Math.min(1, Math.max(0, intensity));
  return -BOB_AMPLITUDE * level * Math.cos(2 * Math.PI * stridePhase(distance)) || 0;
}

/** Footfalls crossed while walking from `from` to `to` metres, capped so one long frame cannot machine-gun. */
export function footsteps(from: number, to: number): number {
  if (!(to > from)) return 0;
  return Math.min(2, Math.floor(stridePhase(to)) - Math.floor(stridePhase(from)));
}

export interface FeelState {
  /** Total distance walked in Play. */
  readonly distance: number;
  /** Smoothed bob amplitude, 0..1. */
  readonly bob: number;
  /** Smoothed FOV offset in degrees. */
  readonly fov: number;
}
export const INITIAL_FEEL: FeelState = { distance: 0, bob: 0, fov: 0 };

export interface FeelFrame {
  readonly state: FeelState;
  /** Eye height offset in metres. */
  readonly bobY: number;
  /** Vertical field of view in degrees. */
  readonly fov: number;
  /** Footfalls this frame (for the step sound). Counted whatever the visual flags say. */
  readonly steps: number;
  /** True while something is still easing, so the scene keeps rendering frames. */
  readonly settling: boolean;
}

/** One frame of feel. `speed` is the actual speed (m/s) after collisions and `travelled` the distance this frame. */
export function advanceFeel(state: FeelState, input: { speed: number; travelled: number; dt: number; flags: FeelFlags }): FeelFrame {
  const { speed, travelled, dt, flags } = input;
  const ratio = Math.min(1, Math.max(0, speed / REFERENCE_SPEED));
  const distance = state.distance + Math.max(0, travelled);
  const bob = flags.bob ? approach(state.bob, ratio, dt) : 0;
  const fov = flags.fovKick ? approach(state.fov, FOV_KICK * ratio, dt) : 0;
  const settling = (flags.bob && (bob > 1e-3 || ratio > 0)) || (flags.fovKick && (Math.abs(fov) > 1e-2 || ratio > 0));
  return {
    state: { distance, bob: bob < 1e-3 && ratio === 0 ? 0 : bob, fov: Math.abs(fov) < 1e-2 && ratio === 0 ? 0 : fov },
    bobY: flags.bob ? bobHeight(distance, bob) : 0,
    fov: BASE_FOV + (flags.fovKick ? fov : 0),
    steps: footsteps(state.distance, distance),
    settling,
  };
}

export interface CrosshairView { readonly state: 'idle' | 'target'; readonly prompt: string }
/** Crosshair state and prompt text: `target` while something interactable is in reach and no dialog is open. */
export function crosshairView(label: string | null | undefined, dialogOpen: boolean): CrosshairView {
  if (!label || dialogOpen) return { state: 'idle', prompt: '' };
  return { state: 'target', prompt: `E · ${label}` };
}
