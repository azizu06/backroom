import { MONITOR_FACE } from './props/monitors';
import { OFFICE_ANCHORS } from './state';
import { WORKSTATIONS, type Vec2 } from './layout';
import { DESKS } from './targets/desk';
import { ROLES } from './palette';

export interface FurniturePiece {
  at: [number, number, number];
  size: [number, number, number];
  color: string;
  rotation?: [number, number, number];
}
export type DeskRoom = typeof DESKS[number];
/** Encloses the procedural chair and opt-in kit chair, including its curved back. */
export const CHAIR_FOOTPRINT = { x: 0.05, z: 0.9, width: 0.65, depth: 0.65 } as const;

/** Business desks use the same outward-facing furniture as every seat in their pod. */
export function deskPieces(room: DeskRoom): FurniturePiece[] {
  const { center, color } = OFFICE_ANCHORS[room];
  return workstationPieces(center, room === 'dana' ? -1 : 1, color);
}

export function workstationPieces([x, z]: Vec2, flip: 1 | -1, color: string): FurniturePiece[] {
  const facing = flip === -1 ? Math.PI : 0;
  const part = (at: FurniturePiece['at'], size: FurniturePiece['size'], color: string, turn = 0): FurniturePiece =>
    ({ at: [x + flip * at[0], at[1], z + flip * at[2]], size, color, rotation: [0, facing + turn, 0] });
  return [
    part([0, 0.83, 0], [2.25, 0.16, 1.05], ROLES.desk),
    ...[-0.9, 0.9].map(x => part([x, 0.4, 0], [0.13, 0.8, 0.8], ROLES.partition)),
    part([MONITOR_FACE.x, MONITOR_FACE.y, MONITOR_FACE.z], [MONITOR_FACE.width + 0.1, MONITOR_FACE.height + 0.1, 0.08], ROLES.frame),
    part([MONITOR_FACE.x, 0.96, MONITOR_FACE.z], [0.1, 0.22, 0.1], ROLES.frame),
    part([0.65, 0.95, 0.1], [0.4, 0.06, 0.5], ROLES.rug, -0.12),
    part([0.05, 0.45, 0.9], [0.65, 0.14, 0.6], color),
    part([0.05, 0.77, 1.14], [0.65, 0.65, 0.12], color),
    part([0.05, 0.19, 0.9], [0.08, 0.38, 0.08], ROLES.frame),
    part([0.05, 0.025, 0.9], [0.6, 0.05, 0.55], ROLES.frame),
  ];
}

/** Monitor face follows its desk's rotation, 0.05 m in front of the casing. */
export function deskScreenPiece(room: DeskRoom): FurniturePiece {
  const { center: [x, z] } = OFFICE_ANCHORS[room];
  const flip = room === 'dana' ? -1 : 1;
  return { at: [x + flip * MONITOR_FACE.x, MONITOR_FACE.y, z + flip * (MONITOR_FACE.z + 0.05)],
    size: [MONITOR_FACE.width + 0.01, MONITOR_FACE.height + 0.01, 0.015], color: ROLES.screenGlow, rotation: [0, room === 'dana' ? Math.PI : 0, 0] };
}

/** The eight unassigned seats complete the same pods as the four business desks. */
export const EXTRA_WORKSTATIONS = WORKSTATIONS.filter(({ center }) =>
  !DESKS.some(room => OFFICE_ANCHORS[room].center[0] === center[0] && OFFICE_ANCHORS[room].center[1] === center[1]));

/** Keep foliage at the perimeter, clear of entry and desk aisles. */
export const PLANT_SPOTS = [[11.3, 6.8], [-11.3, -6.8]] as const;
