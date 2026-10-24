import { OFFICE_PROP_INTERACTIONS } from '../props';
import { INITIAL_OFFICE } from '../state';
import { defineTarget } from './types';

// Treasury already has a dedicated target and denial panel.
const props = OFFICE_PROP_INTERACTIONS.filter(prop => prop.id !== 'treasury-door');

export const propTarget = defineTarget<{ kind: 'prop'; id: string }>({
  id: 'prop',
  candidates({ visible, snapshot }) {
    const view = snapshot ?? { ...INITIAL_OFFICE, rooms: [...visible].map(id => ({ id, rowId: id })) };
    return props.filter(prop => prop.visible(view)).map(prop => ({
      target: { kind: 'prop', id: prop.id } as const, position: prop.position, radius: prop.radius,
    }));
  },
  key: target => `prop:${target.id}`,
  label: (_, target) => target.id === 'whiteboard' ? 'Read the whiteboard'
    : target.id === 'clock' ? 'Check the clock' : 'Look at the desk screen',
  panel(snapshot, target) {
    const prop = props.find(prop => prop.id === target.id);
    if (!prop?.visible(snapshot)) return null;
    return { kind: 'prop', ...prop.panel(snapshot, Date.now()), entries: [] };
  },
});
