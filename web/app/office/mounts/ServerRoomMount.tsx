'use client';

import { SERVER_ROOM } from '../../../lib/office/play';
import { ServerRoom } from '../rooms/ServerRoom';

/** GX10 server room at SERVER_ROOM; Play makes the same footprint solid and interactable. */
export function ServerRoomMount() {
  return <ServerRoom position={[SERVER_ROOM.position[0], 0, SERVER_ROOM.position[1]]} />;
}
