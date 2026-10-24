import { OFFICE_ANCHORS } from './state';
import { DESKS } from './targets/desk';

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
    part([0, 0.83, 0], [2.25, 0.16, 1.05], '#bcaa8c'),
    ...[-0.9, 0.9].map(x => part([x, 0.4, 0], [0.13, 0.8, 0.8], '#485049')),
    part([-0.35, 1.18, -0.23], [0.78, 0.5, 0.08], '#343d36'),
    part([-0.35, 0.96, -0.23], [0.1, 0.22, 0.1], '#485049'),
    part([0.65, 0.95, 0.1], [0.4, 0.06, 0.5], '#e7ddc5', -0.12),
    part([0.05, 0.45, -0.9], [0.65, 0.14, 0.6], color),
    part([0.05, 0.77, -1.14], [0.65, 0.65, 0.12], color),
  ];
}

export function deskScreenPiece(room: DeskRoom): FurniturePiece {
  const { center: [x, z], color } = OFFICE_ANCHORS[room];
  const flip = room === 'dana' ? -1 : 1;
  return { at: [x - flip * 0.35, 1.18, z - flip * 0.18], size: [0.67, 0.37, 0.015], color,
    rotation: [0, room === 'dana' ? Math.PI : 0, 0] };
}

export const PLANT_SPOTS = [[-7.1, -4.6], [7.1, -4.6], [1.7, 4.5]] as const;
