import { SPACES } from '../layout';
import { COURT } from './game';

const room = SPACES.break_room.rect;
/** Long axis runs east/west, in the open strip north of the dining table and sofa. */
export const PINGPONG_TABLE = { x: room.minX + 3.5, z: room.minZ + 1.4, rotation: Math.PI / 2 } as const;
export const PINGPONG_COLLIDER = {
  minX: PINGPONG_TABLE.x - COURT.halfLength, maxX: PINGPONG_TABLE.x + COURT.halfLength,
  minZ: PINGPONG_TABLE.z - COURT.halfWidth, maxZ: PINGPONG_TABLE.z + COURT.halfWidth,
};
