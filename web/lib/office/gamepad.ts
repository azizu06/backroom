/**
 * Pure gamepad mapping for first-person Play (standard mapping). Visual only: a pad walks and looks
 * like the keyboard does and never writes state. No DOM access; the caller passes the pad in.
 */
import type { PlayInput } from "./play";

export const GAMEPAD_DEADZONE = 0.18;
/** Radians per second at full right-stick deflection. */
export const GAMEPAD_LOOK_SPEED = 2.4;

export interface PadLike {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}
export interface PadState {
  readonly move: readonly [x: number, y: number];
  readonly look: readonly [x: number, y: number];
  readonly interact: boolean;
  readonly exit: boolean;
  readonly connected: boolean;
}
export const IDLE_PAD: PadState = { move: [0, 0], look: [0, 0], interact: false, exit: false, connected: false };

const BUTTON = { interact: 0, exit: 1, up: 12, down: 13, left: 14, right: 15 } as const;

function clamp(value: number) { return Math.min(1, Math.max(-1, value)); }

/** 0 inside the deadzone, rescaled to 0..1 outside it; the sign is kept. */
export function deadzone(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= GAMEPAD_DEADZONE) return 0;
  return Math.sign(value) * Math.min(1, (magnitude - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE));
}

export function readPad(pad: PadLike | null | undefined): PadState {
  if (!pad) return IDLE_PAD;
  const axis = (index: number) => deadzone(pad.axes[index] ?? 0);
  const button = (index: number) => !!pad.buttons[index]?.pressed;
  const dpad = (positive: number, negative: number) => (button(positive) ? 1 : 0) - (button(negative) ? 1 : 0);
  return {
    // Push up = forward: the stick reports up as negative y.
    move: [clamp(axis(0) + dpad(BUTTON.right, BUTTON.left)) || 0, clamp(-axis(1) + dpad(BUTTON.up, BUTTON.down)) || 0],
    look: [axis(2), axis(3)],
    interact: button(BUTTON.interact),
    exit: button(BUTTON.exit),
    connected: true,
  };
}

/** True only on the press edge, so holding a button fires once. */
export function padEdges(previous: PadState, next: PadState): { interact: boolean; exit: boolean } {
  return { interact: next.interact && !previous.interact, exit: next.exit && !previous.exit };
}

/** Feeds the pad into Play input for a `dt`-second frame; returns whether the pad is moving or looking. */
export function applyPad(input: PlayInput, state: PadState, dt: number): boolean {
  input.setJoystick(state.move[0], state.move[1]);
  const [x, y] = state.look;
  if (x || y) input.look(-x * GAMEPAD_LOOK_SPEED * dt, -y * GAMEPAD_LOOK_SPEED * dt);
  return state.move[0] !== 0 || state.move[1] !== 0 || x !== 0 || y !== 0;
}
