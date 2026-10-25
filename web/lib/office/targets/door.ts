import { DOOR_WIDTH, doorPosition, INTERIOR_DOORS, type DoorId } from '../doors';
import { interactionStore } from '../interactions';
import { defineTarget } from './types';

export const doorTarget = defineTarget<{ kind: 'door'; room: DoorId }>({
  id: 'door',
  candidates: ({ visible }) => INTERIOR_DOORS.filter(room => visible.has(room)).map(room => {
    const [x, z] = doorPosition(room);
    const open = interactionStore.getSnapshot().doors[room];
    // The open leaf is beside the frame, not in the middle of the passage.
    return {
      target: { kind: 'door', room },
      position: open ? [x - DOOR_WIDTH / 2, z + DOOR_WIDTH / 2] as const : [x, z] as const,
      radius: open ? 0.1 : DOOR_WIDTH / 2,
      blocksInteraction: !open,
    };
  }),
  key: target => `door:${target.room}`,
  label: (_, target) => `${interactionStore.getSnapshot().doors[target.room] ? 'Close' : 'Open'} door`,
  activate: target => interactionStore.toggleDoor(target.room),
  panel: () => null,
});
