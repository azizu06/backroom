import { INTERACT_RANGE } from '../play';
import type { FloorPosition } from '../state';

/** In-world interaction hint, e.g. "E: open". The Play HUD prompt ("E · label") stays the source of truth for what E does. */
export function promptText(verb: string, key = 'E'): string {
  return `${key}: ${verb}`;
}

/** Floor distance from the eye to the edge of a thing (centre distance minus its radius); never negative. */
export function reachGap(eye: FloorPosition, position: FloorPosition, radius: number): number {
  return Math.max(0, Math.hypot(position[0] - eye[0], position[1] - eye[1]) - radius);
}

/** Same reach rule as Play's pickTarget (edge distance within INTERACT_RANGE), minus the view cone. */
export function withinReach(eye: FloorPosition, position: FloorPosition, radius: number, range = INTERACT_RANGE): boolean {
  return reachGap(eye, position, radius) <= range;
}
