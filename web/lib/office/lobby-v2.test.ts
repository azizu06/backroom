import { describe, expect, it } from 'vitest';
import { INITIAL_OFFICE, type OfficeSnapshot } from './state';
import { latestLobbyDecisions, lobbyModeLabel, lobbyStats, lobbyRoster } from './lobby-v2';

const row = (id: string, decision: string) => ({ id, agentId: 'a', seatId: 'collections', action: 'review', decision,
  ruleIds: [`RULE_${id}`], summary: id }) as (typeof INITIAL_OFFICE.audit)[number];

describe('lobby v2 projections', () => {
  it('derives counts and roster values from the snapshot fixture', () => {
    const snapshot: OfficeSnapshot = { ...INITIAL_OFFICE, ...{
      inboxCount: 3,
      agents: [{ id: 'a', name: 'Alex', seatId: 'collections', targetAnchor: 'collections', pos: [-5, -1.8] as const,
        state: 'Reviewing', escalationId: 'e' }],
      badges: [{ seatId: 'collections', policyVersion: 4, actions: ['review'], rooms: [], limits: {} }],
      audit: [row('1', 'ESCALATE'), row('2', 'DENY')],
    } };
    expect(lobbyStats(snapshot)).toEqual({ inbox: 3, held: 1, denied: 1, escalations: 1 });
    expect(lobbyRoster(snapshot)[0]).toMatchObject({ name: 'Alex', desk: 'Collections', badge: { policyVersion: 4 } });
  });

  it('handles an empty snapshot', () => {
    expect(lobbyStats(INITIAL_OFFICE)).toEqual({ inbox: 0, held: 0, denied: 0, escalations: 0 });
    expect(latestLobbyDecisions(INITIAL_OFFICE)).toEqual([]);
  });

  it('ignores unknown decision values and keeps the latest five newest first', () => {
    const snapshot = { ...INITIAL_OFFICE, audit: [row('1', 'ALLOW'), row('2', 'OTHER'), row('3', 'DENY'),
      row('4', 'ESCALATE'), row('5', 'RECORDED'), row('6', 'ALLOW'), row('7', 'DENY')] };
    expect(latestLobbyDecisions(snapshot).map(entry => entry.id)).toEqual(['7', '6', '5', '4', '3']);
  });

  it('never returns non-finite count values and labels preview modes', () => {
    expect(lobbyStats({ ...INITIAL_OFFICE, inboxCount: Number.NaN }).inbox).toBe(0);
    expect(lobbyModeLabel('preview')).toBe('Preview');
    expect(lobbyModeLabel('replay')).toBe('REPLAY');
    expect(lobbyModeLabel('live')).toBeUndefined();
  });
});
