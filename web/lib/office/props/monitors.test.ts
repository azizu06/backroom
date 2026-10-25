import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type AnchorId, type OfficeAgent, type OfficeAudit, type OfficeSnapshot } from '../state';
import { MONITOR_DESKS, monitorInteraction, monitorOverview, monitorScreen, monitorScreenKey } from './monitors';
import { OFFICE_PROP_INTERACTIONS, propInteractions } from './index';

const agent = (patch: Partial<OfficeAgent> = {}): OfficeAgent => ({
  id: 'collections-clerk', name: 'Alex', seatId: 'collections', targetAnchor: 'collections',
  pos: OFFICE_ANCHORS.collections.position, state: 'Reviewing invoice 1042', ...patch,
});
const row = (id: string, decision: OfficeAudit['decision'], seatId = 'collections', summary = `row ${id}`): OfficeAudit =>
  ({ id, agentId: `${seatId}-clerk`, seatId, action: 'propose_plan', decision, ruleIds: [], summary });
const snapshot = (patch: Partial<OfficeSnapshot> = {}): OfficeSnapshot => ({ ...INITIAL_OFFICE, connection: 'preview', ...patch });
const withRooms = (...ids: AnchorId[]) => snapshot({ rooms: ids.map(id => ({ id, rowId: `row:${id}` })) });

describe('monitorScreen', () => {
  it('uses two compact overview rows while keeping full task data intact', () => {
    const screen = monitorScreen(snapshot({ agents: [agent({ state: 'Matching' })] }), 'collections');
    expect(monitorOverview(screen)).toEqual(['Alex', 'Matching']);
    expect(screen.lines[0]!.text).toBe('Alex · Matching');
    expect(monitorOverview(monitorScreen(snapshot(), 'payables'))).toEqual(['Idle', 'Idle']);
    expect(monitorOverview(monitorScreen(snapshot(), 'dana'))).toEqual(['Dana', 'Wait: 0']);
  });

  it('shows receipt decisions in overview without inferring business outcomes', () => {
    for (const [decision, label] of [['ALLOW', 'ALLOW'], ['DENY', 'DENY'], ['ESCALATE', 'HOLD'], ['RECORDED', 'LOGGED']] as const) {
      expect(monitorOverview(monitorScreen(snapshot({ audit: [row('1', decision)] }), 'collections'))[1]).toBe(label);
    }
    expect(monitorOverview(monitorScreen(snapshot({ agents: [agent({ targetAnchor: 'treasury' })] }), 'collections'))[1]).toBe('Away');
    expect(monitorOverview(monitorScreen(snapshot({ agents: [agent({ targetAnchor: 'dana', escalationId: 'e1' })] }), 'collections'))[1]).toBe('Folder');
  });

  it('shows the seated agent name and state under the seat name', () => {
    const screen = monitorScreen(snapshot({ agents: [agent({ state: 'Matching' })] }), 'collections');
    expect(screen.heading).toBe('Collections');
    expect(screen.lines).toEqual([{ kind: 'agent', text: 'Alex · Matching' }]);
    expect(screen.status).toBeNull();
  });

  it('preserves full task text for measured wrapping on the canvas', () => {
    const [first] = monitorScreen(snapshot({ agents: [agent()] }), 'collections').lines;
    expect(first!.text).toBe('Alex · Reviewing invoice 1042');
    const jules = agent({ name: 'Jules', state: 'Checking vendor evidence' });
    expect(monitorScreen(snapshot({ agents: [jules] }), 'collections').lines[0]!.text)
      .toBe('Jules · Checking vendor evidence');
  });

  it('adds an arrow line for an agent away from its seat and a folder line when escalating', () => {
    const away = monitorScreen(snapshot({ agents: [agent({ targetAnchor: 'treasury', state: 'Walking' })] }), 'collections');
    expect(away.lines.map(entry => entry.text)).toEqual(['Alex · Walking', '→ Treasury']);
    const escalating = monitorScreen(snapshot({ agents: [agent({ targetAnchor: 'dana', state: 'Waiting', escalationId: 'e1' })] }), 'collections');
    expect(escalating.lines.map(entry => entry.text)).toEqual(['Alex · Waiting', `→ ${OFFICE_ANCHORS.dana.name}`, 'Folder → Dana']);
  });

  it('shows Idle when nobody is seated and the seat’s latest decision as status', () => {
    const screen = monitorScreen(snapshot({ agents: [agent()], audit: [row('1', 'DENY', 'payables'), row('2', 'ALLOW', 'payables'), row('3', 'ESCALATE')] }), 'payables');
    expect(screen).toEqual({ heading: 'Payables', lines: [{ kind: 'idle', text: 'Idle' }], status: { decision: 'ALLOW', key: 'allow' } });
    expect(monitorScreen(snapshot({ audit: [row('1', 'RECORDED', 'vendor_onboarding')] }), 'vendor_onboarding').status)
      .toEqual({ decision: 'RECORDED', key: 'recorded' });
  });

  it('counts escalations awaiting Dana and shows the newest escalation', () => {
    const screen = monitorScreen(snapshot({
      agents: [agent({ escalationId: 'e1' }), agent({ id: 'b', name: 'Sam', seatId: 'payables', escalationId: 'e2' }), agent({ id: 'c', name: 'Jules', seatId: 'vendor_onboarding' })],
      audit: [row('1', 'ESCALATE', 'collections', 'older escalation'), row('2', 'ESCALATE', 'payables', 'Invoice 1042 · four installments → Dana'), row('3', 'ALLOW')],
    }), 'dana');
    expect(screen.heading).toBe(OFFICE_ANCHORS.dana.name);
    expect(screen.lines[0]).toEqual({ kind: 'awaiting', text: 'Awaiting you: 2' });
    expect(screen.lines[1]!.kind).toBe('escalation');
    expect(screen.lines[1]!.text).toBe('Invoice 1042 · four installments → Dana');
    expect(screen.status).toEqual({ decision: 'ESCALATE', key: 'escalate' });
  });

  it('shows Dana idle with no stale pill once nothing is awaiting', () => {
    const idle = { heading: OFFICE_ANCHORS.dana.name, lines: [{ kind: 'awaiting', text: 'Awaiting you: 0' }, { kind: 'idle', text: 'Idle' }], status: null };
    expect(monitorScreen(snapshot(), 'dana')).toEqual(idle);
    // An earlier escalation stays in the audit after the folder is resolved; the screen must not keep showing it.
    expect(monitorScreen(snapshot({ agents: [agent()], audit: [row('1', 'ESCALATE', 'collections', 'Invoice 1042 · four installments → Dana')] }), 'dana')).toEqual(idle);
  });

  it('caps a screen at 4 lines and is deterministic', () => {
    const value = snapshot({ agents: ['a', 'b', 'c'].map(id => agent({ id, name: id, targetAnchor: 'dana', escalationId: id })) });
    const screen = monitorScreen(value, 'collections');
    expect(screen.lines).toHaveLength(4);
    expect(screen.lines.map(entry => entry.kind)).toEqual(['agent', 'away', 'folder', 'agent']);
    expect(monitorScreen(value, 'collections')).toEqual(screen);
    expect(monitorScreenKey(monitorScreen(value, 'collections'))).toBe(monitorScreenKey(screen));
  });
});

describe('monitorInteraction', () => {
  it('registers one unique interaction per desk', () => {
    const ids = OFFICE_PROP_INTERACTIONS.map(prop => prop.id).filter(id => id.startsWith('monitor:'));
    expect(ids).toEqual(MONITOR_DESKS.map(room => `monitor:${room}`));
    expect(new Set(OFFICE_PROP_INTERACTIONS.map(prop => prop.prompt)).size).toBe(OFFICE_PROP_INTERACTIONS.length);
    expect(monitorInteraction('payables').prompt).toBe('Read Payables screen');
  });

  it('stands in front of each screen, near its desk', () => {
    const [cx, cz] = monitorInteraction('collections').position, [dx, dz] = monitorInteraction('dana').position;
    expect([cx, cz]).toEqual([OFFICE_ANCHORS.collections.center[0] - 0.35, OFFICE_ANCHORS.collections.center[1] + 1.65]);
    expect([dx, dz]).toEqual([OFFICE_ANCHORS.dana.center[0] + 0.35, OFFICE_ANCHORS.dana.center[1] - 1.65]);
    for (const room of MONITOR_DESKS) {
      const [x, z] = monitorInteraction(room).position, [cx, cz] = OFFICE_ANCHORS[room].center;
      expect(Math.hypot(x - cx, z - cz)).toBeLessThan(monitorInteraction(room).radius);
    }
  });

  it('follows visibleRooms', () => {
    const ids = (value: OfficeSnapshot) => propInteractions(value).map(prop => prop.id).filter(id => id.startsWith('monitor:'));
    expect(ids(snapshot({ rooms: undefined }))).toEqual(MONITOR_DESKS.map(room => `monitor:${room}`));
    expect(ids(withRooms())).toEqual([]);
    expect(ids(withRooms('dana', 'lobby'))).toEqual(['monitor:dana']);
    expect(ids(withRooms('payables', 'vendor_onboarding', 'treasury'))).toEqual(['monitor:payables', 'monitor:vendor_onboarding']);
  });

  it('builds the panel from heading, lines and status', () => {
    const value = snapshot({ agents: [agent({ state: 'Matching' })], audit: [row('1', 'DENY')] });
    expect(monitorInteraction('collections').panel(value, 0)).toEqual({
      title: 'Collections', rows: [{ label: 'Agent', value: 'Alex · Matching' }, { label: 'Latest', value: 'DENY' }],
    });
  });
});
