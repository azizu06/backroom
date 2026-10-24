import { describe, expect, it } from "vitest";
import { GAMEPAD_DEADZONE, GAMEPAD_LOOK_SPEED, IDLE_PAD, applyPad, deadzone, padEdges, readPad, type PadLike } from "./gamepad";
import { PlayInput } from "./play";

function pad(axes: number[] = [], pressed: number[] = []): PadLike {
  return { axes, buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: pressed.includes(index) })) };
}

describe("deadzone", () => {
  it("is zero inside the deadzone and rescales outside it keeping the sign", () => {
    expect(deadzone(0)).toBe(0);
    expect(deadzone(GAMEPAD_DEADZONE)).toBe(0);
    expect(deadzone(-GAMEPAD_DEADZONE / 2)).toBe(0);
    expect(deadzone(1)).toBe(1);
    expect(deadzone(-1)).toBe(-1);
    expect(deadzone(1.5)).toBe(1);
    expect(deadzone((1 + GAMEPAD_DEADZONE) / 2)).toBeCloseTo(0.5);
    expect(deadzone(-(1 + GAMEPAD_DEADZONE) / 2)).toBeCloseTo(-0.5);
    expect(deadzone(Number.NaN)).toBe(0);
  });
});

describe("readPad", () => {
  it("maps the standard layout: left stick moves (up = forward), right stick looks, A interacts, B exits", () => {
    const state = readPad(pad([1, -1, -1, 1], [0, 1]));
    expect(state).toEqual({ move: [1, 1], look: [-1, 1], interact: true, exit: true, connected: true });
  });
  it("treats missing axes and buttons as idle", () => {
    expect(readPad({ axes: [], buttons: [] })).toEqual({ move: [0, 0], look: [0, 0], interact: false, exit: false, connected: true });
    expect(readPad({ axes: [1], buttons: [{ pressed: true }] })).toMatchObject({ move: [1, 0], look: [0, 0], interact: true, exit: false });
    expect(readPad(null)).toEqual(IDLE_PAD);
  });
  it("moves with the d-pad and clamps when combined with the stick", () => {
    expect(readPad(pad([], [12])).move).toEqual([0, 1]);
    expect(readPad(pad([], [13])).move).toEqual([0, -1]);
    expect(readPad(pad([], [14])).move).toEqual([-1, 0]);
    expect(readPad(pad([], [15])).move).toEqual([1, 0]);
    expect(readPad(pad([0, -1], [12])).move).toEqual([0, 1]);
    expect(readPad(pad([0, 0.1])).move).toEqual([0, 0]);
  });
});

describe("padEdges", () => {
  it("fires only on the press edge", () => {
    const up = readPad(pad());
    const a = readPad(pad([], [0]));
    const b = readPad(pad([], [1]));
    expect(padEdges(up, a)).toEqual({ interact: true, exit: false });
    expect(padEdges(a, a)).toEqual({ interact: false, exit: false });
    expect(padEdges(a, up)).toEqual({ interact: false, exit: false });
    expect(padEdges(up, b)).toEqual({ interact: false, exit: true });
    expect(padEdges(IDLE_PAD, b)).toEqual({ interact: false, exit: true });
  });
});

describe("applyPad", () => {
  it("drives the joystick and look, then zeroes the joystick when the sticks return to centre", () => {
    const input = new PlayInput();
    expect(applyPad(input, readPad(pad([0, -1, 1, -1])), 0.5)).toBe(true);
    expect(input.joystick).toEqual([0, 1]);
    const [dYaw, dPitch] = input.consumeLook();
    expect(dYaw).toBeCloseTo(-GAMEPAD_LOOK_SPEED * 0.5);
    expect(dPitch).toBeCloseTo(GAMEPAD_LOOK_SPEED * 0.5);

    expect(applyPad(input, readPad(pad([0.05, -0.1, 0, 0])), 0.5)).toBe(false);
    expect(input.joystick).toEqual([0, 0]);
    expect(input.consumeLook()).toEqual([0, 0]);
    expect(input.active()).toBe(false);
  });
});
