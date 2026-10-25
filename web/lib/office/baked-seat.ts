import type { FurniturePiece } from './furniture';
import { PALETTE } from './palette';
import { OFFICE_ANCHORS } from './state';
import { DESKS, DESK_SIZE } from './targets/desk';

/**
 * Where a baked character (`?art=baked`) sits to type: a swivel stool on the room side of its desk, in front of a
 * keyboard at the desk's front edge (desk-local metres, +z toward the room; Dana's desk is turned around, so every
 * offset flips). The blocky Bear and its anchor never read this; only the GLB clone moves.
 *
 * The keyboard sits in the free strip in front of the blush pad (furniture.ts) and right of the books
 * (props/roomDetail.ts). The character's type clip reaches about 0.33 m ahead of its body axis at about 0.78 m above
 * its feet, so the seat sits that far back from the keys and lifts the character until the hands meet them.
 */
export const KEYBOARD_LOCAL = { x: 0.63, z: 0.455, width: 0.5, depth: 0.13, height: 0.03 } as const;
/** Body axis, desk-local. Far enough from the front edge (0.525) that the belly clears it. */
export const SEAT_LOCAL = { x: KEYBOARD_LOCAL.x, z: 0.785 } as const;
/** Desk top surface (furniture.ts slab: centre 0.83, 0.16 thick). */
export const DESK_TOP_Y = 0.91;
/** Root lift while seated, so the type clip's hands (about 0.78 m when standing) rest on the keys. */
export const SIT_LIFT_M = 0.2;
/** Hip flexion while seated (thighs forward); the knees bend back by the same angle so the shins hang. */
export const SIT_HIP_RAD = Math.PI / 2;
/** Stool cushion top: the character's hip joint (0.44 m) minus the thigh radius, plus the lift. */
export const STOOL_SEAT_TOP = 0.365 + SIT_LIFT_M;
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
  const flip = room === 'dana' ? -1 : 1;
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

/** The seat for a desk room, or null for a room without a desk. */
export function deskSeat(room: string): DeskSeat | null {
  if (!isSeatDesk(room)) return null;
  const [x, z] = deskToWorld(room, SEAT_LOCAL.x, SEAT_LOCAL.z);
  const [kx, kz] = deskToWorld(room, SEAT_LOCAL.x, 0);
  return { x, z, heading: headingToward(x, z, kx, kz) };
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
 * A swivel stool (cushion, post, footrest ring, cross base) and the keyboard, in palette colours, for each desk room.
 * View only: no colliders (agents and the player already keep clear of the desk front).
 */
export function seatPieces(room: SeatDesk): FurniturePiece[] {
  const facing = room === 'dana' ? Math.PI : 0;
  const at = (x: number, y: number, z: number): [number, number, number] => {
    const [wx, wz] = deskToWorld(room, x, z);
    return [wx, y, wz];
  };
  const piece = (x: number, y: number, z: number, size: [number, number, number], color: string): FurniturePiece =>
    ({ at: at(x, y, z), size, color, rotation: [0, facing, 0] });
  const { x: sx, z: sz } = SEAT_LOCAL;
  const ringY = 0.3;
  const ring = 0.17;
  const k = KEYBOARD_LOCAL;
  return [
    piece(sx, STOOL_SEAT_TOP - 0.04, sz, [0.4, 0.08, 0.38], PALETTE.coral),
    piece(sx, STOOL_SEAT_TOP - 0.1, sz, [0.3, 0.04, 0.28], PALETTE.navy),
    piece(sx, (STOOL_SEAT_TOP - 0.12) / 2, sz, [0.06, STOOL_SEAT_TOP - 0.12, 0.06], PALETTE.slate),
    piece(sx, ringY, sz - ring, [ring * 2 + 0.03, 0.03, 0.03], PALETTE.slate),
    piece(sx, ringY, sz + ring, [ring * 2 + 0.03, 0.03, 0.03], PALETTE.slate),
    piece(sx - ring, ringY, sz, [0.03, 0.03, ring * 2], PALETTE.slate),
    piece(sx + ring, ringY, sz, [0.03, 0.03, ring * 2], PALETTE.slate),
    piece(sx, 0.02, sz, [0.46, 0.04, 0.06], PALETTE.navy),
    piece(sx, 0.02, sz, [0.06, 0.04, 0.46], PALETTE.navy),
    piece(k.x, DESK_TOP_Y + k.height / 2, k.z, [k.width, k.height, k.depth], PALETTE.navy),
    piece(k.x, DESK_TOP_Y + k.height + 0.004, k.z + 0.005, [k.width - 0.05, 0.008, k.depth - 0.04], PALETTE.cream),
  ];
}

/** Desk depth check used by tests: the seat's body axis stays this far outside the desk's front edge. */
export const SEAT_CLEARANCE_M = SEAT_LOCAL.z - DESK_SIZE.depth / 2;
