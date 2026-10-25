/** Human-scale furniture dimensions shared by rendering, seats, collisions and routing. */
export const DESK_SIZE = { width: 2.25, depth: 1.05 } as const;
export const CHAIR_FOOTPRINT = { x: 0.05, z: 0.9, width: 0.65, depth: 0.65 } as const;
export const CAMERA_CLEARANCE = 0.4;
export const STATION_OFFSET = CHAIR_FOOTPRINT.z + CHAIR_FOOTPRINT.depth / 2 + CAMERA_CLEARANCE + 0.1;
