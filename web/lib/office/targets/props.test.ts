import { afterEach, describe, expect, it, vi } from 'vitest';
import { OFFICE_PROP_INTERACTIONS } from '../props';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type AnchorId, type OfficeSnapshot } from '../state';
import { interactCandidates, pickTarget, playPanel, targetKey, targetLabel } from '../play';

const rooms = Object.keys(OFFICE_ANCHORS) as AnchorId[];
const snapshot: OfficeSnapshot = {
  ...INITIAL_OFFICE, rooms: rooms.map(id => ({ id, rowId: id })), connection: 'preview', inboxCount: 7,
  audit: [{ id: 'receipt', agentId: 'a', seatId: 'payables', action: 'pay_invoice', decision: 'DENY', ruleIds: ['LIMIT'], summary: 'Invoice held' }],
};

afterEach(() => vi.useRealTimers());

describe('Play prop targets', () => {
  it('registers visible descriptors with their position, radius and distinct keys, excluding the existing Treasury target', () => {
    const candidates = interactCandidates([], rooms, snapshot);
    const props = candidates.filter(candidate => candidate.target.kind === 'prop');
    expect(props).toHaveLength(OFFICE_PROP_INTERACTIONS.length - 1);
    for (const descriptor of OFFICE_PROP_INTERACTIONS.filter(prop => prop.id !== 'treasury-door')) {
      expect(props).toContainEqual({ target: { kind: 'prop', id: descriptor.id }, position: descriptor.position, radius: descriptor.radius });
    }
    expect(new Set(props.map(candidate => targetKey(candidate.target))).size).toBe(props.length);
    expect(candidates.filter(candidate => candidate.target.kind === 'treasury')).toHaveLength(1);
    expect(props.some(candidate => candidate.target.kind === 'prop' && candidate.target.id === 'treasury-door')).toBe(false);
  });

  it('hides props with their rooms and rejects vanished or unknown panel targets', () => {
    expect(interactCandidates([], []).filter(candidate => candidate.target.kind === 'prop')).toEqual([]);
    expect(interactCandidates([], ['payables']).filter(candidate => candidate.target.kind === 'prop').map(candidate => targetKey(candidate.target)))
      .toEqual(['prop:whiteboard', 'prop:monitor:payables']);
    const hidden = { ...snapshot, rooms: [] };
    expect(playPanel(hidden, { kind: 'prop', id: 'whiteboard' })).toBeNull();
    expect(playPanel(snapshot, { kind: 'prop', id: 'missing' })).toBeNull();
    expect(playPanel(snapshot, { kind: 'prop', id: 'treasury-door' })).toBeNull();
  });

  it('picks the whiteboard, clock and desk screens with readable prompts', () => {
    const candidates = interactCandidates([], rooms, snapshot);
    for (const [id, eye, label] of [
      ['whiteboard', [1.1, -4.2], 'Read the whiteboard'],
      ['clock', [-7.5, 0.9], 'Check the clock'],
      ['monitor:collections', [-5.35, -1.9], 'Look at the desk screen'],
    ] as const) {
      const target = { kind: 'prop', id } as const;
      expect(pickTarget(eye, 0, candidates)).toEqual(target);
      expect(targetLabel(snapshot, target)).toBe(label);
    }
  });

  it('passes through descriptor rows from the current snapshot, including clock time', () => {
    vi.useFakeTimers();
    const now = new Date(2026, 9, 24, 9, 41).getTime();
    vi.setSystemTime(now);
    for (const descriptor of OFFICE_PROP_INTERACTIONS.filter(prop => prop.id !== 'treasury-door')) {
      expect(playPanel(snapshot, { kind: 'prop', id: descriptor.id })).toEqual({ kind: 'prop', ...descriptor.panel(snapshot, now), entries: [] });
    }
    expect(playPanel(snapshot, { kind: 'prop', id: 'whiteboard' })?.rows).toContainEqual({ label: 'Inbox', value: '7' });
    expect(playPanel({ ...snapshot, inboxCount: 2 }, { kind: 'prop', id: 'whiteboard' })?.rows).toContainEqual({ label: 'Inbox', value: '2' });
  });
});
