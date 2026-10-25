import { describe, expect, it } from "vitest";
import { WALK_SPEED, PlayInput } from "./play";
import {
  ACCELERATION, BASE_FOV, BOB_AMPLITUDE, DEFAULT_FEEL, FOV_KICK, FRICTION, INITIAL_FEEL, NO_FEEL, REFERENCE_SPEED, STEP_DISTANCE,
  advanceFeel, approach, bobHeight, crosshairView, effectiveFeel, footsteps, integrateVelocity, type FeelState,
} from "./playFeel";
import { DEFAULT_PLAY_SETTINGS, feelFlags } from "./playSettings";

describe("movement integration", () => {
  it("accelerates toward the wished velocity without overshooting", () => {
    let v: [number, number] = [0, 0];
    v = integrateVelocity(v, [0, -3], 1 / 60);
    expect(v[0]).toBe(0);
    expect(v[1]).toBeCloseTo(-ACCELERATION / 60, 6);
    for (let i = 0; i < 30; i++) {
      v = integrateVelocity(v, [0, -3], 1 / 60);
      expect(v[1]).toBeGreaterThanOrEqual(-3);
    }
    expect(v).toEqual([0, -3]);
  });

  it("reaches full speed in about a tenth of a second", () => {
    expect(REFERENCE_SPEED).toBe(WALK_SPEED);
    expect(REFERENCE_SPEED / ACCELERATION).toBeLessThan(0.15);
  });

  it("slows under friction and stops exactly at zero", () => {
    let v: [number, number] = [3, 0];
    v = integrateVelocity(v, [0, 0], 1 / 60);
    expect(v[0]).toBeCloseTo(3 - FRICTION / 60, 6);
    for (let i = 0; i < 20; i++) v = integrateVelocity(v, [0, 0], 1 / 60);
    expect(v).toEqual([0, 0]);
  });

  it("stops within a body length of letting go at walking speed", () => {
    let v: [number, number] = [WALK_SPEED, 0], x = 0;
    while (v[0] > 0) { v = integrateVelocity(v, [0, 0], 1 / 120); x += v[0] / 120; }
    expect(x).toBeLessThan(0.15);
  });

  it("turns a held direction change through the same acceleration, keeping diagonal speed bounded", () => {
    let v: [number, number] = [3, 0];
    v = integrateVelocity(v, [0, -3], 1 / 60);
    expect(Math.hypot(v[0], v[1])).toBeLessThanOrEqual(3 + 1e-9);
    expect(v[1]).toBeLessThan(0);
    expect(v[0]).toBeLessThan(3);
  });

  it("is frame-rate tolerant: a long frame reaches the target instead of overshooting", () => {
    expect(integrateVelocity([0, 0], [3, 0], 0.1)).toEqual([3, 0]);
    expect(integrateVelocity([3, 0], [0, 0], 0.1)).toEqual([0, 0]);
  });

  it("snaps to the wished velocity with smoothing off and ignores bad time steps", () => {
    expect(integrateVelocity([1, 1], [3, 0], 1 / 60, false)).toEqual([3, 0]);
    expect(integrateVelocity([1, 1], [0, 0], 1 / 60, false)).toEqual([0, 0]);
    for (const dt of [0, -1, Number.NaN, Infinity]) expect(integrateVelocity([1, 2], [3, 3], dt)).toEqual([1, 2]);
  });

  it("approach is exponential and stable for any dt", () => {
    expect(approach(0, 1, 0)).toBe(0);
    expect(approach(0, 1, 1 / 60)).toBeGreaterThan(0);
    expect(approach(0, 1, 1 / 60)).toBeLessThan(0.2);
    expect(approach(0, 1, 100)).toBeCloseTo(1, 9);
    expect(approach(1, 0, Number.NaN)).toBe(1);
  });
});

describe("head bob and footsteps", () => {
  it("dips to its lowest on the footfall and is highest between steps", () => {
    expect(bobHeight(0, 1)).toBeCloseTo(-BOB_AMPLITUDE, 9);
    expect(bobHeight(STEP_DISTANCE, 1)).toBeCloseTo(-BOB_AMPLITUDE, 9);
    expect(bobHeight(STEP_DISTANCE / 2, 1)).toBeCloseTo(BOB_AMPLITUDE, 9);
    for (let d = 0; d < 5; d += 0.037) expect(Math.abs(bobHeight(d, 1))).toBeLessThanOrEqual(BOB_AMPLITUDE + 1e-12);
  });

  it("scales with intensity, which is clamped to 0..1.5", () => {
    expect(bobHeight(0.3, 0)).toBe(0);
    expect(bobHeight(0.3, 0.5)).toBeCloseTo(bobHeight(0.3, 1) / 2, 9);
    expect(bobHeight(0.3, 5)).toBe(bobHeight(0.3, 1.5));
    expect(bobHeight(0.3, -1)).toBe(0);
  });

  it("counts a footfall every STEP_DISTANCE and none while standing still", () => {
    expect(footsteps(0, STEP_DISTANCE * 0.99)).toBe(0);
    expect(footsteps(STEP_DISTANCE * 0.99, STEP_DISTANCE * 1.01)).toBe(1);
    expect(footsteps(1, 1)).toBe(0);
    expect(footsteps(2, 1)).toBe(0);
    let total = 0, distance = 0;
    for (let i = 0; i < 600; i++) { const next = distance + WALK_SPEED / 60; total += footsteps(distance, next); distance = next; }
    expect(total).toBe(Math.floor(distance / STEP_DISTANCE));
    expect(total).toBeGreaterThan(25); // ten seconds of walking: roughly three footsteps a second
  });

  it("caps footsteps for one very long frame", () => {
    expect(footsteps(0, 100)).toBe(2);
  });
});

function run(flags: typeof DEFAULT_FEEL, speed: number, seconds: number, from: FeelState = INITIAL_FEEL, fps = 60) {
  let state = from, steps = 0, last = advanceFeel(state, { speed, travelled: 0, dt: 1 / fps, flags });
  for (let i = 0; i < seconds * fps; i++) {
    last = advanceFeel(state, { speed, travelled: speed / fps, dt: 1 / fps, flags });
    state = last.state; steps += last.steps;
  }
  return { state, steps, last };
}

describe("per-frame feel", () => {
  it("kicks the FOV out gently while walking and eases it back at rest", () => {
    const walking = run(DEFAULT_FEEL, WALK_SPEED, 2);
    expect(walking.last.fov).toBeGreaterThan(BASE_FOV + FOV_KICK * 0.95);
    expect(walking.last.fov).toBeLessThanOrEqual(BASE_FOV + FOV_KICK + 1e-9);
    const resting = run(DEFAULT_FEEL, 0, 2, walking.state);
    expect(resting.last.fov).toBe(BASE_FOV);
    expect(resting.last.settling).toBe(false);
    expect(resting.last.bobY).toBe(0);
  });

  it("keeps the kick subtle and never scales past walking speed", () => {
    expect(FOV_KICK).toBeLessThanOrEqual(5);
    const fast = run(DEFAULT_FEEL, WALK_SPEED * 2, 2);
    expect(fast.last.fov).toBeLessThanOrEqual(BASE_FOV + FOV_KICK + 1e-9);
  });

  it("reports settling until the ease finishes, so the scene keeps rendering exactly that long", () => {
    const walking = run(DEFAULT_FEEL, WALK_SPEED, 1);
    expect(advanceFeel(walking.state, { speed: 0, travelled: 0, dt: 1 / 60, flags: DEFAULT_FEEL }).settling).toBe(true);
    expect(run(DEFAULT_FEEL, 0, 3, walking.state).last.settling).toBe(false);
  });

  it("bob follows the walked distance and fades with speed", () => {
    const walking = run({ ...DEFAULT_FEEL, fovKick: false }, WALK_SPEED, 2);
    expect(walking.last.fov).toBe(BASE_FOV);
    const heights: number[] = [];
    let state = walking.state;
    for (let i = 0; i < 60; i++) { const f = advanceFeel(state, { speed: WALK_SPEED, travelled: WALK_SPEED / 60, dt: 1 / 60, flags: DEFAULT_FEEL }); state = f.state; heights.push(f.bobY); }
    expect(Math.max(...heights)).toBeGreaterThan(BOB_AMPLITUDE * 0.9);
    expect(Math.min(...heights)).toBeLessThan(-BOB_AMPLITUDE * 0.9);
    expect(advanceFeel(INITIAL_FEEL, { speed: 0, travelled: 0, dt: 1 / 60, flags: DEFAULT_FEEL }).bobY).toBe(0);
  });

  it("still counts footsteps with every visual effect off", () => {
    const quiet = run(NO_FEEL, WALK_SPEED, 5);
    expect(quiet.steps).toBe(Math.floor(quiet.state.distance / STEP_DISTANCE));
    expect(quiet.steps).toBeGreaterThan(10);
    expect(quiet.last.bobY).toBe(0);
    expect(quiet.last.fov).toBe(BASE_FOV);
    expect(quiet.last.settling).toBe(false);
  });

  it("makes no footsteps when blocked against a wall (no distance travelled)", () => {
    const blocked = run(DEFAULT_FEEL, 0, 3);
    expect(blocked.steps).toBe(0);
    expect(blocked.state.distance).toBe(0);
  });

  it("ignores negative travel and keeps working at low frame rates", () => {
    expect(advanceFeel(INITIAL_FEEL, { speed: 3, travelled: -5, dt: 0.1, flags: DEFAULT_FEEL }).state.distance).toBe(0);
    const slow = run(DEFAULT_FEEL, WALK_SPEED, 5, INITIAL_FEEL, 10);
    expect(slow.steps).toBeGreaterThan(10);
    expect(slow.last.fov).toBeLessThanOrEqual(BASE_FOV + FOV_KICK + 1e-9);
  });
});

describe("reduced motion and settings", () => {
  it("honours the office override while preserving individual switches and intensity", () => {
    const flags = { ...DEFAULT_FEEL, bob: false, useMotionAnyway: true, motionIntensity: 1.5 };
    expect(effectiveFeel(flags, true)).toEqual(flags);
    expect(effectiveFeel(flags, false)).toEqual(flags);
    expect(effectiveFeel({ ...flags, useMotionAnyway: false }, true)).toEqual(NO_FEEL);
    const walking = run(effectiveFeel(flags, true), WALK_SPEED, 2);
    expect(walking.last.bobY).toBe(0);
    expect(walking.last.fov - BASE_FOV).toBeCloseTo(FOV_KICK * 1.5, 3);
  });

  it("scales bob and kick at both slider endpoints, including after an override", () => {
    const normal = run(DEFAULT_FEEL, WALK_SPEED, 2);
    for (const motionIntensity of [0.5, 1, 1.5]) {
      const flags = effectiveFeel({ ...DEFAULT_FEEL, useMotionAnyway: true, motionIntensity }, true);
      const walking = run(flags, WALK_SPEED, 2);
      expect(walking.last.bobY).toBeCloseTo(normal.last.bobY * motionIntensity, 6);
      expect(walking.last.fov - BASE_FOV).toBeCloseTo((normal.last.fov - BASE_FOV) * motionIntensity, 6);
    }
    for (const motionIntensity of [NaN, Infinity]) {
      expect(run({ ...DEFAULT_FEEL, motionIntensity }, WALK_SPEED, 2).last.bobY).toBe(normal.last.bobY);
    }
    expect(run({ ...DEFAULT_FEEL, motionIntensity: 9 }, WALK_SPEED, 2).state.bob).toBeCloseTo(1.5);
    expect(run({ ...DEFAULT_FEEL, motionIntensity: -9 }, WALK_SPEED, 2).state.bob).toBeCloseTo(0.5);
  });

  it("visibly settles after the final step but flattens on the first disabled frame", () => {
    const walking = { distance: STEP_DISTANCE, bob: 1, fov: FOV_KICK };
    const settling = run(DEFAULT_FEEL, 0, 0.1, walking);
    expect(Math.abs(settling.last.bobY)).toBeGreaterThan(0.025);
    expect(settling.last.settling).toBe(true);
    expect(run(DEFAULT_FEEL, 0, 2, walking).last.bobY).toBe(0);
    const off = advanceFeel(walking, { speed: WALK_SPEED, travelled: 0.05, dt: 1 / 60, flags: NO_FEEL });
    expect(off.bobY).toBe(0);
    expect(off.fov).toBe(BASE_FOV);
  });

  it("makes starts and releases stepped without smoothing", () => {
    const smooth = integrateVelocity([0, 0], [WALK_SPEED, 0], 1 / 60, true);
    const stepped = integrateVelocity([0, 0], [WALK_SPEED, 0], 1 / 60, false);
    expect(stepped[0] - smooth[0]).toBeGreaterThan(2);
    expect(integrateVelocity(stepped, [0, 0], 1 / 60, false)).toEqual([0, 0]);
    expect(integrateVelocity(stepped, [0, 0], 1 / 60, true)[0]).toBeGreaterThan(2);
  });

  it("forces every effect off under reduced motion unless explicitly overridden", () => {
    expect(effectiveFeel(DEFAULT_FEEL, true)).toEqual(NO_FEEL);
    expect(effectiveFeel({ smoothing: true, bob: true, fovKick: true }, true)).toEqual({ smoothing: false, bob: false, fovKick: false });
    expect(effectiveFeel(DEFAULT_FEEL, false)).toEqual(DEFAULT_FEEL);
    expect(effectiveFeel({ smoothing: false, bob: true, fovKick: false }, false)).toEqual({ smoothing: false, bob: true, fovKick: false });
  });

  it("under reduced motion nothing eases: velocity snaps and no bob or FOV change", () => {
    const flags = effectiveFeel(DEFAULT_FEEL, true);
    expect(integrateVelocity([0, 0], [0, -3], 1 / 60, flags.smoothing)).toEqual([0, -3]);
    const walking = run(flags, WALK_SPEED, 2);
    expect(walking.last.bobY).toBe(0);
    expect(walking.last.fov).toBe(BASE_FOV);
    expect(walking.last.settling).toBe(false);
  });

  it("defaults all three effects on and maps settings to flags", () => {
    expect(DEFAULT_PLAY_SETTINGS).toMatchObject({ smoothMove: true, headBob: true, fovKick: true });
    expect(feelFlags(DEFAULT_PLAY_SETTINGS)).toEqual(DEFAULT_FEEL);
    expect(feelFlags({ ...DEFAULT_PLAY_SETTINGS, headBob: false })).toEqual({ ...DEFAULT_FEEL, bob: false });
  });

  it("PlayInput carries the feel flags with the defaults", () => {
    expect(new PlayInput().feel).toEqual(DEFAULT_FEEL);
  });
});

describe("crosshair", () => {
  it("is idle with no target and targets with a short prompt when something is in reach", () => {
    expect(crosshairView(null, false)).toEqual({ state: "idle", prompt: "" });
    expect(crosshairView(undefined, false)).toEqual({ state: "idle", prompt: "" });
    expect(crosshairView("", false)).toEqual({ state: "idle", prompt: "" });
    expect(crosshairView("Talk to Alex", false)).toEqual({ state: "target", prompt: "E · Talk to Alex" });
  });

  it("goes idle while a dialog is open", () => {
    expect(crosshairView("Talk to Alex", true)).toEqual({ state: "idle", prompt: "" });
  });
});
