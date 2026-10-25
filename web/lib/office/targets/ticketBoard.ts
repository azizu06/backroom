import { TICKET_BOARD, TICKET_BOARD_POSITION } from '../props/ticketBoard';
import { inboxTarget } from './inbox';
import { defineTarget } from './types';

const candidates = [{
  target: { kind: 'ticket-board' as const },
  position: TICKET_BOARD_POSITION,
  radius: TICKET_BOARD.width / 2,
}];

// The module offers a board target but returns the existing inbox panel kind.
// The panel contract carries no case-focus parameter.
export const ticketBoardTarget = defineTarget<{ kind: 'ticket-board' | 'inbox' }>({
  id: 'ticket-board',
  // The picker adds INTERACT_RANGE to the panel's half-width.
  candidates: () => candidates,
  label: () => 'Open tickets',
  panel: snapshot => inboxTarget.panel(snapshot, { kind: 'inbox' }),
});
