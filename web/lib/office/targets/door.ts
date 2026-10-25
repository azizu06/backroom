import { type DoorId } from '../doors';
import { interactionStore } from '../interactions';
import { defineTarget } from './types';

export const doorTarget = defineTarget<{ kind: 'door'; room: DoorId }>({
  id: 'door',
  candidates: () => [], // Open office has no cosmetic room doors.
  key: target => `door:${target.room}`,
  label: (_, target) => `${interactionStore.getSnapshot().doors[target.room] ? 'Close' : 'Open'} door`,
  activate: target => interactionStore.toggleDoor(target.room),
  panel: () => null,
});
