import { describe, expect, it } from 'vitest';
import { INTERACT_RANGE, interactCandidates, pickTarget } from '../play';
import { INBOX_TRAY, INBOX_TRAY_RADIUS, inboxTarget } from '../targets/inbox';
import { INITIAL_OFFICE, OFFICE_ANCHORS } from '../state';
import { promptText, reachGap, withinReach } from './prompt';

describe('interaction prompt helper', () => {
  it('formats the in-world hint', () => {
    expect(promptText('open')).toBe('E: open');
    expect(promptText('scan', 'F')).toBe('F: scan');
  });
  it('measures reach from the edge of the thing and never goes negative', () => {
    expect(reachGap([0, 0], [3, 4], 1)).toBeCloseTo(4);
    expect(reachGap([0, 0], [0.2, 0], 1)).toBe(0);
  });
  it('gates on the Play interact range, inclusive at the boundary', () => {
    const at = (distance: number) => withinReach([INBOX_TRAY[0], INBOX_TRAY[1] + distance], INBOX_TRAY, INBOX_TRAY_RADIUS);
    expect(at(INBOX_TRAY_RADIUS + INTERACT_RANGE)).toBe(true);
    expect(at(INBOX_TRAY_RADIUS + INTERACT_RANGE + 0.01)).toBe(false);
    expect(at(0)).toBe(true);
    expect(withinReach([0, 0], [5, 0], 0.4, 6)).toBe(true);
  });
});

describe('inbox tray Play target', () => {
  const rooms = ['payables'] as const;
  it('is offered only while the Payables desk is visible', () => {
    expect(inboxTarget.candidates({ agents: [], visible: new Set(rooms) })).toHaveLength(1);
    expect(inboxTarget.candidates({ agents: [], visible: new Set(['lobby']) })).toEqual([]);
  });
  it('is picked at the desk end facing it, but the desk wins from the aisle centre', () => {
    const candidates = interactCandidates([], [...rooms]);
    expect(pickTarget([INBOX_TRAY[0], INBOX_TRAY[1] + 0.5], 0, candidates)?.kind).toBe('inbox');
    expect(pickTarget([OFFICE_ANCHORS.payables.center[0], INBOX_TRAY[1] + 0.4], 0, candidates)?.kind).toBe('desk');
    expect(pickTarget([INBOX_TRAY[0], INBOX_TRAY[1] + 2.5], 0, candidates)).toBeNull();
  });
  it('labels with the count of items in the inbox and lists inbox receipts newest first', () => {
    const snapshot = { ...INITIAL_OFFICE, inboxCount: 2, inboxReceipts: [
      { id: 'i1', agentId: 'a', seatId: 'payables', action: 'submit_inbox_item', decision: 'RECORDED' as const, ruleIds: [], summary: 'first' },
      { id: 'i2', agentId: 'a', seatId: 'payables', action: 'route_inbox_item', decision: 'ALLOW' as const, ruleIds: ['R1'], summary: 'second' },
    ] };
    expect(inboxTarget.label(snapshot, { kind: 'inbox' })).toBe('Open inbox tray · 2 in inbox');
    const panel = inboxTarget.panel(snapshot, { kind: 'inbox' });
    expect(panel?.state).toBe('2 in inbox');
    expect(panel?.entries.map(entry => entry.id)).toEqual(['i2', 'i1']);
    expect(inboxTarget.panel(INITIAL_OFFICE, { kind: 'inbox' })?.entries).toEqual([]);
    expect(inboxTarget.panel(INITIAL_OFFICE, { kind: 'inbox' })?.task).toBeUndefined();
    // Preview counts items without receipts: the dialog says so rather than implying an empty inbox.
    expect(inboxTarget.panel({ ...INITIAL_OFFICE, inboxCount: 3 }, { kind: 'inbox' })?.task).toContain('3 intake items');
    expect(inboxTarget.panel(snapshot, { kind: 'inbox' })?.task).toBeUndefined();
  });
});
