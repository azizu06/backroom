/**
 * Per-viewer Play preferences: look sensitivity, invert Y and walking speed. Pure and storage-agnostic;
 * the HUD reads and writes them through `loadPlaySettings` / `savePlaySettings` (localStorage, best effort).
 */
import { LOOK_SENSITIVITY } from "./play";
import { DEFAULT_FEEL, type FeelFlags } from "./playFeel";

export interface PlaySettings {
  /** Multiplier on the base look sensitivity (mouse and touch drag). */
  readonly sensitivity: number;
  /** Moving the mouse or finger up looks down. */
  readonly invertY: boolean;
  /** Multiplier on the walking speed. */
  readonly speed: number;
  /** Acceleration and friction instead of instant start and stop. */
  readonly smoothMove: boolean;
  /** Eye bobs with each step. */
  readonly headBob: boolean;
  /** Field of view widens slightly while walking. */
  readonly fovKick: boolean;
}
export interface SettingRange { readonly min: number; readonly max: number; readonly step: number }

export const DEFAULT_PLAY_SETTINGS: PlaySettings = {
  sensitivity: 1, invertY: false, speed: 1, smoothMove: DEFAULT_FEEL.smoothing, headBob: DEFAULT_FEEL.bob, fovKick: DEFAULT_FEEL.fovKick,
};
export const SENSITIVITY_RANGE: SettingRange = { min: 0.25, max: 3, step: 0.25 };
export const SPEED_RANGE: SettingRange = { min: 0.5, max: 2, step: 0.25 };
export const PLAY_SETTINGS_KEY = "backroom.office.play-settings.v1";

/** Clamps to the range and snaps to its step; anything non-numeric falls back. */
export function clampSetting(value: unknown, range: SettingRange, fallback: number): number {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number)) return fallback;
  const snapped = Math.round((number - range.min) / range.step) * range.step + range.min;
  return Math.min(range.max, Math.max(range.min, Number(snapped.toFixed(4))));
}

/** Validates stored JSON; unknown or broken fields keep their defaults. */
export function parsePlaySettings(raw: string | null | undefined): PlaySettings {
  if (!raw) return DEFAULT_PLAY_SETTINGS;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return DEFAULT_PLAY_SETTINGS; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return DEFAULT_PLAY_SETTINGS;
  const row = data as Record<string, unknown>;
  return {
    sensitivity: clampSetting(row.sensitivity, SENSITIVITY_RANGE, DEFAULT_PLAY_SETTINGS.sensitivity),
    invertY: typeof row.invertY === "boolean" ? row.invertY : DEFAULT_PLAY_SETTINGS.invertY,
    speed: clampSetting(row.speed, SPEED_RANGE, DEFAULT_PLAY_SETTINGS.speed),
    smoothMove: typeof row.smoothMove === "boolean" ? row.smoothMove : DEFAULT_PLAY_SETTINGS.smoothMove,
    headBob: typeof row.headBob === "boolean" ? row.headBob : DEFAULT_PLAY_SETTINGS.headBob,
    fovKick: typeof row.fovKick === "boolean" ? row.fovKick : DEFAULT_PLAY_SETTINGS.fovKick,
  };
}

export function sameSettings(a: PlaySettings, b: PlaySettings): boolean {
  return a.sensitivity === b.sensitivity && a.invertY === b.invertY && a.speed === b.speed
    && a.smoothMove === b.smoothMove && a.headBob === b.headBob && a.fovKick === b.fovKick;
}

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem" | "removeItem">;
/** Storage can be missing or throw (private windows, blocked site data): fall back to defaults. */
export function loadPlaySettings(storage: Reader | null | undefined): PlaySettings {
  try { return parsePlaySettings(storage?.getItem(PLAY_SETTINGS_KEY)); } catch { return DEFAULT_PLAY_SETTINGS; }
}
/** Best effort; defaults are removed rather than stored. Returns whether the write went through. */
export function savePlaySettings(storage: Writer | null | undefined, settings: PlaySettings): boolean {
  if (!storage) return false;
  try {
    if (sameSettings(settings, DEFAULT_PLAY_SETTINGS)) storage.removeItem(PLAY_SETTINGS_KEY);
    else storage.setItem(PLAY_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch { return false; }
}

/**
 * Pointer movement (pixels; +y is down the screen) to a look change. Without inversion, moving up
 * looks up (pitch increases), matching the default Play mapping. `scale` lets touch drag look faster.
 */
export function lookDelta(dx: number, dy: number, settings: PlaySettings, scale = 1): [dYaw: number, dPitch: number] {
  const gain = LOOK_SENSITIVITY * settings.sensitivity * scale;
  return [-dx * gain || 0, (settings.invertY ? dy : -dy) * gain || 0];
}

/** The settings' feel switches as the flags the rig reads (before reduced motion is applied). */
export function feelFlags(settings: PlaySettings): FeelFlags {
  return { smoothing: settings.smoothMove, bob: settings.headBob, fovKick: settings.fovKick };
}

export function formatMultiplier(value: number): string {
  return `${Number(value.toFixed(2))}×`;
}
