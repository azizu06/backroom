import { MONITOR_FACE } from './props/monitors';
import { OFFICE_ANCHORS } from './state';
import { roomPoint } from './layout';
import { DESKS } from './targets/desk';
import { ROLES } from './palette';

export interface FurniturePiece {
  at: [number, number, number];
  size: [number, number, number];
  color: string;
  rotation?: [number, number, number];
}
export type DeskRoom = typeof DESKS[number];

/** Exactly the existing desk-local layout, including Dana's half-turn. No collider changes. */
export function deskPieces(room: DeskRoom): FurniturePiece[] {
  const { center: [x, z], color } = OFFICE_ANCHORS[room];
  const facing = room === 'dana' ? Math.PI : 0;
  const flip = room === 'dana' ? -1 : 1;
  const part = (at: FurniturePiece['at'], size: FurniturePiece['size'], color: string, turn = 0): FurniturePiece =>
    ({ at: [x + flip * at[0], at[1], z + flip * at[2]], size, color, rotation: [0, facing + turn, 0] });
  return [
    part([0, 0.83, 0], [2.25, 0.16, 1.05], ROLES.desk),
    ...[-0.9, 0.9].map(x => part([x, 0.4, 0], [0.13, 0.8, 0.8], ROLES.partition)),
    part([MONITOR_FACE.x, MONITOR_FACE.y, MONITOR_FACE.z], [MONITOR_FACE.width + 0.1, MONITOR_FACE.height + 0.1, 0.08], ROLES.frame),
    part([MONITOR_FACE.x, 0.96, MONITOR_FACE.z], [0.1, 0.22, 0.1], ROLES.frame),
    part([0.65, 0.95, 0.1], [0.4, 0.06, 0.5], ROLES.rug, -0.12),
    part([0.05, 0.45, -0.9], [0.65, 0.14, 0.6], color),
    part([0.05, 0.77, -1.14], [0.65, 0.65, 0.12], color),
  ];
}

/** Every screen faces +z (Dana's monitor turns back toward the room), 0.05 in front of its casing. */
export function deskScreenPiece(room: DeskRoom): FurniturePiece {
  const { center: [x, z] } = OFFICE_ANCHORS[room];
  const flip = room === 'dana' ? -1 : 1;
  return { at: [x + flip * MONITOR_FACE.x, MONITOR_FACE.y, z + flip * MONITOR_FACE.z + 0.05],
    size: [MONITOR_FACE.width + 0.01, MONITOR_FACE.height + 0.01, 0.015], color: ROLES.screenGlow, rotation: [0, 0, 0] };
}

/** Corner plants: Collections' and the Vendor Desk's back corners, and Dana's front corner. */
export const PLANT_SPOTS = [
  roomPoint('collections', -2.1, -1.6), roomPoint('vendor_onboarding', 2.1, -1.6), roomPoint('dana', 1.7, 1.1),
  // Meeting room's back-east corner, the break room's south-east corner and the corridor's west end.
  [11.3, -6.8], [11.3, 6.8], [-11.3, 1.0],
] as const;
