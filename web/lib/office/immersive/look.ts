/**
 * Pure first-person look maths: the sensitivity setting's mapping to radians per pixel and the
 * acceleration-free damping the rig applies to mouse and touch look. View only.
 */
import { LOOK_SENSITIVITY } from '../play';

/** The look sensitivity setting is a multiplier on the base gain; this is its range (matches the Play settings slider). */
export const SENSITIVITY_MIN = 0.25;
export const SENSITIVITY_MAX = 3;
/** 1 / seconds. About 40 ms to close most of a mouse movement: smooth, never laggy. */
export const LOOK_DAMP_RATE = 25;
/** Radians of pending look below which the rest is applied at once, so the camera settles exactly. */
export const LOOK_SETTLE = 1e-5;

/**
 * Radians per pixel for a sensitivity multiplier. Linear in the multiplier and in the pointer movement
 * (no acceleration curve); non-finite values fall back to 1×, others clamp to the setting's range.
 */
export function sensitivityGain(multiplier: number): number {
  const level = Number.isFinite(multiplier) ? Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, multiplier)) : 1;
  return LOOK_SENSITIVITY * level;
}

/**
 * Share of the pending look applied this frame: exponential and frame-rate independent, so the same
 * movement always ends in the same place (no acceleration). `smoothing` off (or reduced motion) applies it all.
 */
export function lookDampFraction(dt: number, smoothing = true, rate = LOOK_DAMP_RATE): number {
  if (!smoothing || !Number.isFinite(dt)) return 1;
  if (dt <= 0) return 0;
  return 1 - Math.exp(-rate * dt);
}
