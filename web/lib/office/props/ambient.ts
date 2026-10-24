import { visibleRooms, type AnchorId, type OfficeSnapshot } from '../state';
import { MONITOR_MAX_LINES } from './monitors';

/** Ambient ticks per second while active: a low on-demand rate, never a continuous render loop. */
export const AMBIENT_FPS = 6;
/** Seconds per screen-glow breath. */
export const GLOW_PERIOD = 5;
/** Resting glow, also the static pose under reduced motion, a hidden tab or replay. */
export const GLOW_MEAN = 0.85;
export const GLOW_AMPLITUDE = 0.15;
/** Seconds per plant-sway cycle. */
export const SWAY_PERIOD = 3.7;
/** Largest plant sway, radians. */
export const SWAY_MAX = 0.035;
/** A seat counts as busy while one of its audit rows is among this many newest rows. */
export const BUSY_RECENT_ROWS = 3;
export const IDLE_BUSY = 0.4;
/** Desks that carry a monitor, in seed order. */
export const AMBIENT_DESKS = ['collections', 'payables', 'vendor_onboarding', 'dana'] as const satisfies readonly AnchorId[];
export type AmbientDesk = typeof AMBIENT_DESKS[number];

const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const phase = (seed: number) => (seed * GOLDEN_ANGLE) % TAU;

/** Ambience runs only for a visible tab without reduced motion; recorded playback stays still. */
export function ambientActive(snapshot: OfficeSnapshot, reduced: boolean, hidden: boolean): boolean {
  return !reduced && !hidden && snapshot.connection !== 'replay';
}

/** Slow breathing screen intensity in [GLOW_MEAN - GLOW_AMPLITUDE, GLOW_MEAN + GLOW_AMPLITUDE] (within 0..1). */
export function screenGlow(t: number, seed: number): number {
  return GLOW_MEAN + GLOW_AMPLITUDE * Math.sin(TAU * t / GLOW_PERIOD + phase(seed));
}

/** Small foliage rotation in radians, |angle| <= SWAY_MAX. */
export function plantSway(t: number, seed: number): number {
  const a = TAU * t / SWAY_PERIOD + phase(seed);
  return SWAY_MAX * (0.75 * Math.sin(a) + 0.25 * Math.sin(2.3 * a + 1));
}

/** Text cursor at 1 Hz: on for the first half of each second. */
export function cursorBlink(t: number): boolean {
  return Math.floor(t * 2) % 2 === 0;
}

/** 1 when the seat's agent is at its desk with a recent audit row, 0.4 when seated and idle, 0 when empty. */
export function busyLevel(snapshot: OfficeSnapshot, room: AnchorId): number {
  const seated = snapshot.agents.some(agent => agent.seatId === room && agent.targetAnchor === room);
  if (!seated) return 0;
  return snapshot.audit.slice(-BUSY_RECENT_ROWS).some(row => row.seatId === room) ? 1 : IDLE_BUSY;
}

/** Monitor desks on the visible floor, each with a stable seed. */
export function ambientDesks(snapshot: OfficeSnapshot): { room: AmbientDesk; seed: number }[] {
  const rooms = visibleRooms(snapshot);
  return AMBIENT_DESKS.flatMap((room, seed) => rooms.includes(room) ? [{ room, seed }] : []);
}

/**
 * DeskMonitors' screen layout (see drawScreen): a 256 x 144 px texture on a 0.66 x 0.36 face centred at
 * desk-local (-0.35, 1.18); body lines start at x 10 px with baselines at 50 + i * 19 px, 13 px type.
 */
const SCREEN_TEX_W = 256, SCREEN_TEX_H = 144, SCREEN_FACE_W = 0.66, SCREEN_FACE_H = 0.36, SCREEN_CENTER = [-0.35, 1.18] as const;
const TEXT_LEFT_PX = 10, FIRST_BASELINE_PX = 50, LINE_STEP_PX = 19;
/** Cursor block size in screen-texture pixels: one 13 px glyph cell. */
export const CURSOR_PX = [6, 10] as const;
export const CURSOR_SIZE = [CURSOR_PX[0] * SCREEN_FACE_W / SCREEN_TEX_W, CURSOR_PX[1] * SCREEN_FACE_H / SCREEN_TEX_H] as const;

/** Desk-local (x, y) centre of the text cursor: the start of the empty line after the screen's last body line. */
export function cursorPoint(lineCount: number): readonly [x: number, y: number] {
  const slot = Math.min(Math.max(Math.floor(lineCount), 0), MONITOR_MAX_LINES);
  const px = TEXT_LEFT_PX + CURSOR_PX[0] / 2, py = FIRST_BASELINE_PX + slot * LINE_STEP_PX - CURSOR_PX[1] / 2;
  return [
    SCREEN_CENTER[0] - SCREEN_FACE_W / 2 + px * SCREEN_FACE_W / SCREEN_TEX_W,
    SCREEN_CENTER[1] + SCREEN_FACE_H / 2 - py * SCREEN_FACE_H / SCREEN_TEX_H,
  ];
}
