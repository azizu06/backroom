import type { SceneCollider } from '../../../app/office/mounts/types';
import { TICKET_BOARD_BOX } from './ticketBoard';

/** Pure registry, loaded by Play even before the lazy scene mounts. */
export const extraColliders: SceneCollider[] = [];
export function registerExtraCollider(collider: SceneCollider): void {
  if (!extraColliders.includes(collider)) extraColliders.push(collider);
}
registerExtraCollider(TICKET_BOARD_BOX);
