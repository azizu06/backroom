import { describe, expect, it } from 'vitest';
import { HANDOFF_AGENTS, type Handoff } from './handoffs';
import { agentCards } from './agent-cards';
import { createMockOfficeState } from './preview';
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
  it('shows the demo preview desk tasks without handoffs and moves an escalated task to Needs you once', () => {
    const preview = createMockOfficeState();
    const snapshot = preview.source.getSnapshot();
    const model = ticketBoard(snapshot, 1000);
    expect(model.empty).toBe(false);
    expect(model.notice).toBe('Preview · sample tickets');
    expect(model.columns.map(column => column.count)).toEqual([0, 3, 0, 0]);
    for (const agent of snapshot.agents) {
      const shared = agentCards(snapshot, 1000).find(card => card.agentId === agent.id)!;
      expect(model.columns[1]!.cards).toContainEqual(expect.objectContaining({
        caseDisplayId: shared.title, summary: agent.state, agent: agent.name, tag: 'WORKING',
        color: HANDOFF_AGENTS[agent.seatId === 'vendor_onboarding' ? 'vendor' : agent.seatId].color,
      }));
    }
    expect(ticketBoardText(model)).not.toContain('No tickets yet');
    preview.setTargetAnchor('dana');
    const escalated = ticketBoard(preview.source.getSnapshot(), 1000);
    expect(escalated.columns.map(column => column.count)).toEqual([0, 2, 1, 0]);
    expect(escalated.columns[1]!.cards.map(card => card.agent).sort()).toEqual(['Jules', 'Sam']);
    expect(escalated.columns[2]!.cards[0]).toMatchObject({ agent: 'Alex', tag: 'NEEDS YOU', summary: 'Invoice 1042 · four installments → Dana' });
  });
  it('uses shared task text and tags once when preview agents gain handoffs', () => {
    const preview = createMockOfficeState().source.getSnapshot();
    const agents = preview.agents;
    const handoffs = [
      handoff('alex', 'accepted', { toAgentId: agents[0]!.id, toRole: 'collections' }),
      handoff('sam', 'offered', { toAgentId: agents[1]!.id }),
      handoff('jules', 'completed', { toAgentId: agents[2]!.id, toRole: 'vendor', completedAt: 900 }),
    ];
    const snapshot = { ...preview, handoffs };
    const model = ticketBoard(snapshot, 1000);
    expect(model.columns.map(column => column.count)).toEqual([1, 1, 0, 1]);
    for (const task of agentCards(snapshot, 1000).filter(card => card.tag !== 'READY')) {
      expect(model.columns.flatMap(column => column.cards)).toContainEqual(expect.objectContaining({
        summary: task.line, tag: task.tag,
      }));
    }
    // A human-wait reason and its audit receipt represent one task, even without decisionRef.
    const waiting = ticketBoard({ ...snapshot,
      audit: [{ ...receipt('approval'), agentId: agents[0]!.id }],
      handoffs: handoffs.map(row => row.handoffId === 'alex' ? { ...row, reason: 'Requires human approval' } : row),
    }, 1000);
    expect(waiting.columns.map(column => column.count)).toEqual([1, 0, 1, 1]);
    expect(waiting.columns[2]!.cards[0]).toMatchObject({ agent: 'Alex', tag: 'NEEDS YOU' });
    const finished = ticketBoard({ ...snapshot, handoffs: handoffs.map(row => ({ ...row, status: 'rejected' as const })) }, 1000);
    expect(finished.columns.map(column => column.count)).toEqual([0, 0, 0, 3]);
    expect(finished.columns[3]!.cards.every(card => card.rejected)).toBe(true);
  });
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
    expect(standalone.columns[2]!.cards[0]).toMatchObject({ caseDisplayId: 'Sam · Payables', agent: 'Sam' });
  });
  it('shows ESCALATE receipts once, newest first; normal intake receipts are not human waits', () => {
    const first = receipt('r1'), last = receipt('r2');
    const model = ticketBoard({ ...INITIAL_OFFICE, audit: [first, last], inboxReceipts: [first, last, receipt('ok', 'ALLOW')] });
    expect(model.columns[2]!.cards.map(card => card.id)).toEqual(['receipt:r2', 'receipt:r1']);
    const linked = ticketBoard({ ...fixture, audit: [first], handoffs: [handoff('h', 'accepted', { decisionRef: 'r1' })] });
    expect(linked.columns[2]!.cards).toHaveLength(1);
    expect(linked.columns[2]!.cards[0]!.caseDisplayId).toBe('INV-h');
  });
  it('groups receipt waits by case while keeping unrelated unknown cases separate', () => {
    const model = ticketBoard({ ...INITIAL_OFFICE, audit: [
      { ...receipt('audit:38'), refs: ['4481'], summary: 'Bank change requested for vendor:acme' },
      { ...receipt('review:uuid'), refs: ['4481'], summary: 'Bank change held for vendor:acme' },
      { ...receipt('judge:39'), refs: ['4482'], summary: 'Invoice review required' },
    ] });
    expect(model.columns[2]!.count).toBe(2);
    expect(model.columns[2]!.cards.find(card => card.caseDisplayId === 'INV-4481')?.summary).toBe('Held for Dana · bank change');
    expect(ticketBoardText(model)).not.toMatch(/audit:|review:|judge:|vendor:acme/);
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
