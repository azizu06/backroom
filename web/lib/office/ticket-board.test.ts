import { describe, expect, it } from 'vitest';
import { HANDOFF_AGENTS, type Handoff } from './handoffs';
import { INITIAL_OFFICE, type OfficeAudit, type OfficeSnapshot } from './state';
import { ticketBoard, ticketBoardKey, ticketBoardText } from './ticket-board';
import { INTERACT_RANGE, interactCandidates, pickTarget, playPanel, targetLabel } from './play';
import { inboxTarget } from './targets/inbox';
import { TICKET_BOARD, TICKET_BOARD_POSITION } from './props/ticketBoard';

const handoff = (id: string, status: Handoff['status'], extra: Partial<Handoff> = {}): Handoff => ({
  handoffId: id, sequence: 1n, caseDisplayId: `INV-${id}`, fromAgentId: 'intake-1', toAgentId: 'payables-1',
  fromRole: 'intake', toRole: 'payables', fromVoiceRole: 'intake_sorter', toVoiceRole: 'payables',
  status, correction: false, reason: 'Review', summary: 'Check the invoice', line: 'Please review', createdAt: 100, ...extra,
});
const receipt = (id: string, decision: OfficeAudit['decision'] = 'ESCALATE'): OfficeAudit => ({
  id, agentId: 'auditor-1', seatId: 'auditor', action: 'judge_inbox_decision', decision, ruleIds: [], summary: 'Human review required',
});
const fixture: OfficeSnapshot = {
  ...INITIAL_OFFICE, connection: 'live',
  agents: [{ id: 'payables-1', name: 'Sam', seatId: 'payables', targetAnchor: 'payables', pos: [0, 0], state: 'reviewing' }],
  handoffs: [handoff('queued', 'offered'), handoff('work', 'accepted'),
    handoff('human', 'offered', { toRole: 'human' }), handoff('done', 'completed'), handoff('denied', 'rejected')],
};

describe('ticket board projection', () => {
  it('maps state into columns, keeps owner identity and marks rejected tickets', () => {
    const model = ticketBoard(fixture);
    expect(model.columns.map(column => [column.name, column.count])).toEqual([
      ['Queued', 1], ['In progress', 1], ['Needs you', 1], ['Done', 2],
    ]);
    expect(model.columns[1]!.cards[0]).toMatchObject({ agent: 'Sam', color: HANDOFF_AGENTS.payables.color, tag: 'WORKING' });
    expect(model.columns[0]!.cards[0]!.tag).toBe('READY');
    expect(model.columns[2]!.cards[0]!.tag).toBe('NEEDS YOU');
    expect(model.columns[3]!.cards.find(card => card.id === 'handoff:denied')).toMatchObject({ rejected: true, tag: 'REJECTED' });
    expect(model.columns[3]!.cards.find(card => card.id === 'handoff:done')!.tag).toBe('DONE');
    expect(model.notice).toBeNull();
  });
  it('orders newest first, breaks ties deterministically with u64 sequences and caps each column', () => {
    const handoffs = Array.from({ length: 8 }, (_, index) => handoff(String(index), 'offered', {
      createdAt: index, sequence: BigInt(index), summary: '😀'.repeat(45),
    }));
    const model = ticketBoard({ ...fixture, handoffs });
    expect(model.columns[0]).toMatchObject({ count: 8, more: 2 });
    expect(model.columns[0]!.cards.map(card => card.caseDisplayId)).toEqual(['INV-7', 'INV-6', 'INV-5', 'INV-4', 'INV-3', 'INV-2']);
    expect(model.columns[0]!.cards[0]!.summary).toBe('😀'.repeat(40));
    expect(ticketBoard({ ...fixture, handoffs: [...handoffs].reverse() })).toEqual(model);
    expect(ticketBoardText(model)).toContain('+2 more');
    const tied = [handoff('a', 'accepted', { sequence: 9007199254740992n }), handoff('z', 'accepted', { sequence: 9007199254740993n })];
    expect(ticketBoard({ ...fixture, handoffs: tied }).columns[1]!.cards.map(card => card.caseDisplayId)).toEqual(['INV-z', 'INV-a']);
  });
  it('promotes active handoffs for agent escalations and leaves terminal tickets done', () => {
    const agents = [{ ...fixture.agents[0]!, escalationId: 'e1' }];
    const model = ticketBoard({ ...fixture, agents });
    expect(model.columns.map(column => column.count)).toEqual([0, 0, 3, 2]);
    expect(model.columns[2]!.cards.every(card => card.id.startsWith('handoff:'))).toBe(true);
    const standalone = ticketBoard({ ...fixture, handoffs: [], agents });
    expect(standalone.columns[2]!.cards[0]).toMatchObject({ caseDisplayId: 'e1', agent: 'Sam' });
  });
  it('shows ESCALATE receipts once, newest first; normal intake receipts are not human waits', () => {
    const first = receipt('r1'), last = receipt('r2');
    const model = ticketBoard({ ...INITIAL_OFFICE, audit: [first, last], inboxReceipts: [first, last, receipt('ok', 'ALLOW')] });
    expect(model.columns[2]!.cards.map(card => card.caseDisplayId)).toEqual(['r2', 'r1']);
    const linked = ticketBoard({ ...fixture, audit: [first], handoffs: [handoff('h', 'accepted', { decisionRef: 'r1' })] });
    expect(linked.columns[2]!.cards).toHaveLength(1);
    expect(linked.columns[2]!.cards[0]!.caseDisplayId).toBe('INV-h');
  });
  it.each(['preview', 'replay', 'disconnected'] as const)('keeps empty columns and a %s notice', connection => {
    const model = ticketBoard({ ...INITIAL_OFFICE, connection });
    expect(model.columns).toHaveLength(4);
    expect(model.columns.every(column => column.count === 0 && column.cards.length === 0)).toBe(true);
    expect(model.notice?.toLowerCase()).toContain(connection);
    expect(ticketBoardText(model)).toContain('No tickets yet');
  });
  it('keeps the redraw key stable for unrelated position/count updates and changes it for displayed data', () => {
    const key = ticketBoardKey(ticketBoard(fixture));
    expect(ticketBoardKey(ticketBoard({ ...fixture, inboxCount: 12, agents: [{ ...fixture.agents[0]!, pos: [9, 9] }] }))).toBe(key);
    expect(ticketBoardKey(ticketBoard({ ...fixture, handoffs: [] }))).not.toBe(key);
  });
});

describe('ticket board interaction', () => {
  it('registers the Open tickets prompt at reach and reuses the inbox panel without a new panel contract', () => {
    const [x, z] = TICKET_BOARD_POSITION;
    const candidates = interactCandidates([], []);
    expect(candidates.filter(candidate => candidate.target.kind === 'ticket-board')).toEqual([
      { target: { kind: 'ticket-board' }, position: TICKET_BOARD_POSITION, radius: TICKET_BOARD.width / 2 },
    ]);
    const reach = TICKET_BOARD.width / 2 + INTERACT_RANGE;
    const target = pickTarget([x, z + reach - 0.01], 0, candidates);
    expect(target?.kind).toBe('ticket-board');
    expect(targetLabel(fixture, target!)).toBe('Open tickets');
    expect(playPanel(fixture, target!)).toEqual(inboxTarget.panel(fixture, { kind: 'inbox' }));
    expect(pickTarget([x, z + reach + 0.01], 0, candidates)?.kind).not.toBe('ticket-board');
    expect(pickTarget([x, z + 0.5], Math.PI, candidates)?.kind).not.toBe('ticket-board');
  });
});
