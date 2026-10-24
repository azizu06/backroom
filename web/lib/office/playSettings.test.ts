import { describe, expect, it } from "vitest";
import { LOOK_SENSITIVITY, PlayInput, WALK_SPEED, moveIntent } from "./play";
import {
  DEFAULT_PLAY_SETTINGS, PLAY_SETTINGS_KEY, SENSITIVITY_RANGE, SPEED_RANGE, clampSetting, formatMultiplier, loadPlaySettings,
  lookDelta, parsePlaySettings, savePlaySettings,
} from "./playSettings";

function memory() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

describe("play settings", () => {
  it("stores the movement-feel switches and falls back per field", () => {
    const off = { smoothMove: false, headBob: false, fovKick: false };
    expect(parsePlaySettings(JSON.stringify(off))).toEqual({ ...DEFAULT_PLAY_SETTINGS, ...off });
    expect(parsePlaySettings(JSON.stringify({ headBob: false, smoothMove: "no", fovKick: 1 }))).toEqual({ ...DEFAULT_PLAY_SETTINGS, headBob: false });
    expect(parsePlaySettings(JSON.stringify({ sensitivity: 2 }))).toMatchObject({ smoothMove: true, headBob: true, fovKick: true });
    const storage = memory();
    expect(savePlaySettings(storage, { ...DEFAULT_PLAY_SETTINGS, ...off })).toBe(true);
    expect(loadPlaySettings(storage)).toEqual({ ...DEFAULT_PLAY_SETTINGS, ...off });
    expect(savePlaySettings(storage, { ...DEFAULT_PLAY_SETTINGS, fovKick: false })).toBe(true);
    expect(storage.data.has(PLAY_SETTINGS_KEY)).toBe(true);
  });

  it("parses stored settings and clamps them into range", () => {
    expect(parsePlaySettings(JSON.stringify({ sensitivity: 2, invertY: true, speed: 1.5 }))).toEqual({ ...DEFAULT_PLAY_SETTINGS, sensitivity: 2, invertY: true, speed: 1.5 });
    expect(parsePlaySettings(JSON.stringify({ sensitivity: 99, speed: -4 }))).toEqual({ ...DEFAULT_PLAY_SETTINGS, sensitivity: SENSITIVITY_RANGE.max, speed: SPEED_RANGE.min });
    expect(parsePlaySettings(JSON.stringify({ sensitivity: 1.3 })).sensitivity).toBe(1.25);
  });

  it("falls back to defaults for missing, broken or hostile data", () => {
    for (const raw of [null, undefined, "", "{", "[]", "null", "42", JSON.stringify({ sensitivity: "fast", invertY: "yes", speed: null })]) {
      expect(parsePlaySettings(raw)).toEqual(DEFAULT_PLAY_SETTINGS);
    }
    expect(clampSetting(Number.NaN, SPEED_RANGE, 1)).toBe(1);
    expect(clampSetting(Infinity, SPEED_RANGE, 1)).toBe(1);
    expect(clampSetting("1.75", SPEED_RANGE, 1)).toBe(1.75);
  });

  it("round-trips through storage and removes the key for defaults", () => {
    const storage = memory();
    expect(savePlaySettings(storage, { ...DEFAULT_PLAY_SETTINGS, sensitivity: 0.5, invertY: true, speed: 2 })).toBe(true);
    expect(loadPlaySettings(storage)).toEqual({ ...DEFAULT_PLAY_SETTINGS, sensitivity: 0.5, invertY: true, speed: 2 });
    savePlaySettings(storage, DEFAULT_PLAY_SETTINGS);
    expect(storage.data.has(PLAY_SETTINGS_KEY)).toBe(false);
    expect(loadPlaySettings(storage)).toEqual(DEFAULT_PLAY_SETTINGS);
  });

  it("survives storage that is missing or throws", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(loadPlaySettings(broken)).toEqual(DEFAULT_PLAY_SETTINGS);
    expect(loadPlaySettings(undefined)).toEqual(DEFAULT_PLAY_SETTINGS);
    expect(savePlaySettings(broken, { ...DEFAULT_PLAY_SETTINGS, speed: 2 })).toBe(false);
    expect(savePlaySettings(null, DEFAULT_PLAY_SETTINGS)).toBe(false);
  });

  it("maps pointer movement to look with sensitivity and invert Y", () => {
    const [yaw, pitch] = lookDelta(10, -10, DEFAULT_PLAY_SETTINGS);
    expect(yaw).toBeCloseTo(-10 * LOOK_SENSITIVITY);
    // Moving up (negative dy) looks up by default.
    expect(pitch).toBeCloseTo(10 * LOOK_SENSITIVITY);
    const [, inverted] = lookDelta(10, -10, { ...DEFAULT_PLAY_SETTINGS, invertY: true });
    expect(inverted).toBeCloseTo(-10 * LOOK_SENSITIVITY);
    const [fast] = lookDelta(10, 0, { ...DEFAULT_PLAY_SETTINGS, sensitivity: 2 }, 2);
    expect(fast).toBeCloseTo(-40 * LOOK_SENSITIVITY);
    expect(lookDelta(0, 0, DEFAULT_PLAY_SETTINGS)).toEqual([0, 0]);
  });

  it("scales walking by the input speed", () => {
    const input = new PlayInput();
    input.press("forward");
    expect(Math.hypot(...moveIntent(input, 0, 1))).toBeCloseTo(WALK_SPEED);
    input.speed = 1.5;
    expect(Math.hypot(...moveIntent(input, 0, 1))).toBeCloseTo(WALK_SPEED * 1.5);
  });

  it("formats multipliers for the panel", () => {
    expect(formatMultiplier(1)).toBe("1×");
    expect(formatMultiplier(1.25)).toBe("1.25×");
  });
});
