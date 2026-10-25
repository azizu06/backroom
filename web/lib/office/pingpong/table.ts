import { COURT } from './game';

/** Standalone game coordinates; this retired table is never mounted in the office. */
export const PINGPONG_TABLE = { x: 0, z: 0, rotation: Math.PI / 2 } as const;
export const PINGPONG_COLLIDER = {
  minX: PINGPONG_TABLE.x - COURT.halfLength, maxX: PINGPONG_TABLE.x + COURT.halfLength,
  minZ: PINGPONG_TABLE.z - COURT.halfWidth, maxZ: PINGPONG_TABLE.z + COURT.halfWidth,
};
