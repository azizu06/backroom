import { callStore } from '../calls';
import { OFFICE_ANCHORS, visibleRooms } from '../state';
import type { OfficePropInteraction } from './interact';

/** Collections phone sits aisle-side on the desk at local x .85, z .3; floor y is omitted. */
export const PHONE_INTERACTION: OfficePropInteraction = {
  id: 'desk-phone', prompt: 'Use desk phone', position: [OFFICE_ANCHORS.collections.center[0] + 0.85, OFFICE_ANCHORS.collections.center[1] + 0.3], radius: 0.3,
  visible: snapshot => visibleRooms(snapshot).includes('collections'),
  panel: () => {
    const call = callStore.getSnapshot();
    return { title: 'Collections desk phone', rows: [
      { label: 'Status', value: call.status },
      ...(call.callerLabel ? [{ label: 'Caller', value: call.callerLabel }] : []),
      ...(call.agentName ? [{ label: 'Agent', value: call.agentName }] : []),
    ] };
  },
};
