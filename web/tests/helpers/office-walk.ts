import { BUILDING, DOORWAYS, LOBBY_BOARD_MOUNT, WALL_THICKNESS, WORKSTATIONS } from '../../lib/office/layout';
import { CHAIR_FOOTPRINT } from '../../lib/office/furniture';
import { OFFICE_ANCHORS } from '../../lib/office/state';
import { DESK_SIZE, EYE_HEIGHT, PLAYER_RADIUS, SERVER_ROOM_BOX, SPAWN, officeColliders, type Box } from '../../lib/office/play';
import { AUDIT_WALL } from '../../lib/office/props/auditWall';
import { WHITEBOARD_INTERACTION } from '../../lib/office/props/whiteboard';
import { buildOfficeWalk, type WalkLayout } from '../../lib/office/office-walk';

/** The only adapter tied to application exports. Browser callers supply the rig's actual collider snapshot. */
export function currentWalkLayout(colliders: readonly Box[] = officeColliders(
  Object.keys(OFFICE_ANCHORS) as (keyof typeof OFFICE_ANCHORS)[], [SERVER_ROOM_BOX],
)): WalkLayout {
  return {
    building: BUILDING, spawn: SPAWN, workstations: WORKSTATIONS, anchors: OFFICE_ANCHORS, doorways: DOORWAYS,
    boards: [
      { id: 'notice', position: [LOBBY_BOARD_MOUNT.x, LOBBY_BOARD_MOUNT.z] },
      { id: 'audit', position: [AUDIT_WALL.x, AUDIT_WALL.z] },
      { id: 'whiteboard', position: [WHITEBOARD_INTERACTION.position[0], BUILDING.minZ + WALL_THICKNESS / 2] },
    ],
    desk: DESK_SIZE, chair: CHAIR_FOOTPRINT, colliders, radius: PLAYER_RADIUS, eyeHeight: EYE_HEIGHT,
  };
}

export const currentOfficeWalk = (colliders?: readonly Box[]) => buildOfficeWalk(currentWalkLayout(colliders));
