import { FOLDER_RADIUS } from '../folder';
import { interactionStore } from '../interactions';
import { defineTarget } from './types';

export const folderTarget = defineTarget<{ kind: 'folder' }>({
  id: 'folder',
  candidates: ({ visible }) => {
    const spot = interactionStore.getSnapshot().folder;
    return spot && (spot.room === null || visible.has(spot.room)) ? [{
      target: { kind: 'folder' }, position: [spot.position[0], spot.position[2]], radius: FOLDER_RADIUS,
    }] : [];
  },
  label: () => 'Pick up folder',
  activate: () => interactionStore.pickUp(),
  panel: () => null,
});
