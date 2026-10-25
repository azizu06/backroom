import { describe, expect, it } from 'vitest';
import { officeColliders, movePlayer, PLAYER_RADIUS } from '../play';
import { extraColliders, registerExtraCollider } from './extraColliders';
import { TICKET_BOARD, TICKET_BOARD_BOX } from './ticketBoard';

describe('static mount collider registry', () => {
  it('includes the ticket board before React mounts and registers the same box only once', () => {
    expect(officeColliders([])).toContain(TICKET_BOARD_BOX);
    registerExtraCollider(TICKET_BOARD_BOX);
    expect(extraColliders.filter(box => box === TICKET_BOARD_BOX)).toHaveLength(1);
  });
  it('stops the player at the panel face while preserving caller-supplied geometry', () => {
    const extra = { minX: 10, maxX: 11, minZ: 3, maxZ: 4 };
    const boxes = officeColliders([], [extra]);
    expect(boxes).toContain(extra);
    const end = movePlayer([TICKET_BOARD.x, TICKET_BOARD_BOX.maxZ + 1], [0, -2], boxes);
    expect(end[1]).toBeGreaterThanOrEqual(TICKET_BOARD_BOX.maxZ + PLAYER_RADIUS);
  });
});
