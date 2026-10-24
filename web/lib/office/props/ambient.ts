import { visibleRooms, type AnchorId, type OfficeSnapshot } from '../state';

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
