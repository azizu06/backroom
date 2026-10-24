import type { OfficeSnapshot } from '../state';
import { CLOCK_INTERACTION } from './clock';
import type { OfficePropInteraction } from './interact';
import { WHITEBOARD_INTERACTION } from './whiteboard';

export type { OfficePropInteraction, PropPanel, PropPanelRow } from './interact';
export { WHITEBOARD_INTERACTION, whiteboardStats, type WhiteboardStats } from './whiteboard';
export { CLOCK_INTERACTION, clockFace, msUntilNextMinute, type ClockFace } from './clock';

/** Every office prop's interaction. A new prop adds one line here. */
export const OFFICE_PROP_INTERACTIONS: readonly OfficePropInteraction[] = [
  WHITEBOARD_INTERACTION,
  CLOCK_INTERACTION,
];

export function propInteractions(snapshot: OfficeSnapshot): OfficePropInteraction[] {
  return OFFICE_PROP_INTERACTIONS.filter(prop => prop.visible(snapshot));
}
