'use client';

import { SERVER_ROOM } from '../../../lib/office/play';
import { ServerRoom } from '../rooms/ServerRoom';
import type { SceneMountProps } from './types';

/** GX10 server room at SERVER_ROOM; Play makes the same footprint solid and interactable. */
export function ServerRoomMount({ snapshot }: SceneMountProps) {
  return <ServerRoom replay={snapshot.connection === 'replay'} position={[SERVER_ROOM.position[0], 0, SERVER_ROOM.position[1]]} />;
}
