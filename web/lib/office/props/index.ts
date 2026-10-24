import type { OfficeSnapshot } from '../state';
import { CLOCK_INTERACTION } from './clock';
import type { OfficePropInteraction } from './interact';
import { MONITOR_DESKS, monitorInteraction } from './monitors';
import { WHITEBOARD_INTERACTION } from './whiteboard';
import { PHONE_INTERACTION } from './phone';

export type { OfficePropInteraction, PropPanel, PropPanelRow } from './interact';
export { WHITEBOARD_INTERACTION, whiteboardStats, type WhiteboardStats } from './whiteboard';
export { CLOCK_INTERACTION, clockFace, msUntilNextMinute, type ClockFace } from './clock';
export { MONITOR_DESKS, monitorInteraction, monitorScreen, monitorScreenKey, type MonitorDesk, type MonitorLine, type MonitorScreen, type MonitorStatus } from './monitors';
export { PHONE_INTERACTION } from './phone';

/** Every office prop's interaction. A new prop adds one line here. */
export const OFFICE_PROP_INTERACTIONS: readonly OfficePropInteraction[] = [
  WHITEBOARD_INTERACTION,
  CLOCK_INTERACTION,
  ...MONITOR_DESKS.map(monitorInteraction),
  PHONE_INTERACTION,
];

export function propInteractions(snapshot: OfficeSnapshot): OfficePropInteraction[] {
  return OFFICE_PROP_INTERACTIONS.filter(prop => prop.visible(snapshot));
}
