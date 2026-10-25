import { workstationPieces, type FurniturePiece } from './furniture';
import { CHAIR_FOOTPRINT } from './metrics';
import { WORKSTATIONS, workstationApproach } from './layout';
import { BEAR } from './bear';
import { PALETTE } from './palette';
import { OFFICE_ANCHORS } from './state';
import { DESKS, DESK_SIZE } from './targets/desk';

/** Shared chair geometry: the existing cushion, never an extra stool. */
const furniture = workstationPieces([0, 0], 1, PALETTE.navy);
const cushion = furniture.find(piece => piece.at[0] === CHAIR_FOOTPRINT.x
  && piece.at[2] === CHAIR_FOOTPRINT.z && piece.size[0] === CHAIR_FOOTPRINT.width)!;
export const CHAIR_SEAT_TOP = cushion.at[1] + cushion.size[1] / 2;
export const DESK_TOP_Y = furniture[0]!.at[1] + furniture[0]!.size[1] / 2;
export const SEAT_LOCAL = { x: CHAIR_FOOTPRINT.x, z: CHAIR_FOOTPRINT.z } as const;
export const KEYBOARD_LOCAL = { x: SEAT_LOCAL.x, z: 0.455, width: 0.5, depth: 0.13, height: 0.03 } as const;
/** Type clip reaches about 0.33 m: lean the upper body in while hips stay on the cushion. */
export const SEATED_TORSO_FORWARD_M = SEAT_LOCAL.z - KEYBOARD_LOCAL.z - 0.33;
/** Rest-model thigh underside (tools/bake/character.py). */
export const SIT_LIFT_M = CHAIR_SEAT_TOP - 0.365;
/** The procedural thigh rests on top of the cushion. */
export const BEAR_SEAT_LIFT = CHAIR_SEAT_TOP + BEAR.leg.part.size[2] / 2 - BEAR.hip;
export const SIT_HIP_RAD = Math.PI / 2;
/** Seconds to slide in and fold the legs (instant under reduced motion). */
export const SIT_SECONDS = 0.35;
/** Turn rate (1/s) for the exponential approach to a new heading. */
export const TURN_RATE = 9;

export type SeatDesk = typeof DESKS[number];

export function isSeatDesk(id: string): id is SeatDesk {
  return (DESKS as readonly string[]).includes(id);
}

/** Desk-local (x, z) to world for a desk room. */
function deskToWorld(room: SeatDesk, x: number, z: number): [number, number] {
  const [cx, cz] = OFFICE_ANCHORS[room].center;
  const flip = WORKSTATIONS.find(station => station.center[0] === cx && station.center[1] === cz)!.flip;
  return [cx + flip * x, cz + flip * z];
}

/** Avatar heading (WalkMotion: 0 faces +z, atan2(dx, dz)) that looks from one floor point toward another. */
export function headingToward(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

export interface DeskSeat {
  readonly x: number;
  readonly z: number;
  /** Avatar heading that faces the keyboard (straight at the desk). */
  readonly heading: number;
}

/** All pod seats share the furniture transform, including the seven handoff roles. */
export const WORKSTATION_SEATS = WORKSTATIONS.map(({ center: [x, z], flip }, index) => ({
  x: x + flip * SEAT_LOCAL.x, z: z + flip * SEAT_LOCAL.z,
  heading: flip === 1 ? Math.PI : 0,
  approach: workstationApproach(index),
}));

/** Resolve a stopped agent's logical approach without moving its route or collision anchor. */
export function seatAtApproach(x: number, z: number): DeskSeat | null {
  return WORKSTATION_SEATS.find(seat => Math.hypot(seat.approach[0] - x, seat.approach[1] - z) < 0.05) ?? null;
}

/** The existing chair for a business desk, or null for a room without one. */
export function deskSeat(room: string): DeskSeat | null {
  if (!isSeatDesk(room)) return null;
  return seatAtApproach(...OFFICE_ANCHORS[room].position);
}

/** Signed shortest turn from `from` to `to`, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  const d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) return d - Math.PI * 2;
  if (d <= -Math.PI) return d + Math.PI * 2;
  return d;
}

/** One frame of an exponential turn toward `target` the short way round; reduced motion snaps. */
export function turnToward(current: number, target: number, delta: number, reduced: boolean, rate = TURN_RATE): number {
  if (reduced) return target;
  const step = angleDelta(current, target) * (1 - Math.exp(-rate * Math.max(delta, 0)));
  return current + step;
}

/** One frame of the seat blend (0 standing, 1 seated); reduced motion snaps. */
export function stepSeatBlend(current: number, seated: boolean, delta: number, reduced: boolean): number {
  const target = seated ? 1 : 0;
  if (reduced) return target;
  const step = Math.max(delta, 0) / SIT_SECONDS;
  return seated ? Math.min(1, current + step) : Math.max(0, current - step);
}

/** Smoothstep easing for the slide into the seat. */
export function easeSeat(blend: number): number {
  const t = Math.min(1, Math.max(0, blend));
  return t * t * (3 - 2 * t);
}

/**
 * A keyboard aligned with the existing chair; no duplicate seating geometry.
 * View only: no colliders (agents and the player already keep clear of the desk front).
 */
export function seatPieces(room: SeatDesk): FurniturePiece[] {
  const facing = deskSeat(room)!.heading - Math.PI;
  const at = (x: number, y: number, z: number): [number, number, number] => {
    const [wx, wz] = deskToWorld(room, x, z);
    return [wx, y, wz];
  };
  const piece = (x: number, y: number, z: number, size: [number, number, number], color: string): FurniturePiece =>
    ({ at: at(x, y, z), size, color, rotation: [0, facing, 0] });
  const k = KEYBOARD_LOCAL;
  return [
    piece(k.x, DESK_TOP_Y + k.height / 2, k.z, [k.width, k.height, k.depth], PALETTE.navy),
    piece(k.x, DESK_TOP_Y + k.height + 0.004, k.z + 0.005, [k.width - 0.05, 0.008, k.depth - 0.04], PALETTE.cream),
  ];
}

/** Desk depth check used by tests: the seat's body axis stays this far outside the desk's front edge. */
export const SEAT_CLEARANCE_M = SEAT_LOCAL.z - DESK_SIZE.depth / 2;
