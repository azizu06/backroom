import { OPEN_DOORS, toggleDoor, type DoorId, type DoorState } from './doors';
import { INITIAL_FOLDER, pickUpFolder, putDownFolder, type FolderState } from './folder';
import type { AnchorId, FloorPosition } from './state';

interface LocalInteractions { readonly doors: DoorState; readonly folder: FolderState }
const INITIAL: LocalInteractions = { doors: OPEN_DOORS, folder: INITIAL_FOLDER };

/** Viewer memory only: no OfficeState mutations, persistence, networking or business actions. */
export function createInteractionStore() {
  let state = INITIAL;
  const listeners = new Set<() => void>();
  function update(next: LocalInteractions) { state = next; listeners.forEach(listener => listener()); }
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => INITIAL,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    toggleDoor(room: DoorId) { update({ ...state, doors: toggleDoor(state.doors, room) }); },
    pickUp() { if (state.folder !== null) update({ ...state, folder: pickUpFolder() }); },
    putDown(eye: FloorPosition, yaw: number, rooms: readonly AnchorId[]) {
      if (state.folder === null) update({ ...state, folder: putDownFolder(eye, yaw, rooms) });
    },
  };
}
export const interactionStore = createInteractionStore();
