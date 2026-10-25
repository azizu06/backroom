import { precallRows } from '../../calls/precall';
import { callStore, precallStore } from '../calls';
import { OFFICE_ANCHORS, visibleRooms } from '../state';
import type { OfficePropInteraction } from './interact';

/** Floor-supported phone rail stays underneath the desk, clear of the adjacent seat and aisle. */
export const PHONE_STAND = { x: OFFICE_ANCHORS.collections.center[0] + 0.95, z: OFFICE_ANCHORS.collections.center[1], width: 0.16, depth: 0.8 } as const;
/** Collections phone sits aisle-side on the desk at local x .85, z .3; floor y is omitted. */
export const PHONE_INTERACTION: OfficePropInteraction = {
  // Cover the handset itself at the aisle stop; the desk target's wider footprint otherwise wins
  // when a small yaw/input step leaves the handset just outside its angular pick cone.
  id: 'desk-phone', prompt: 'Use desk phone', position: [OFFICE_ANCHORS.collections.center[0] + 0.85, OFFICE_ANCHORS.collections.center[1] + 0.3], radius: 0.55,
  visible: snapshot => visibleRooms(snapshot).includes('collections'),
  panel: () => {
    const call = callStore.getSnapshot();
    const card = precallStore.getSnapshot();
    return { title: 'Collections desk phone', rows: [
      ...(card ? precallRows(card) : []),
      { label: 'Status', value: call.status },
      ...(call.callerLabel ? [{ label: 'Caller', value: call.callerLabel }] : []),
      ...(call.agentName ? [{ label: 'Agent', value: call.agentName }] : []),
    ] };
  },
};
