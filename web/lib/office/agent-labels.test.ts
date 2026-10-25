import { describe, expect, it } from 'vitest';
import { agentName, agentState } from './agent-labels';

describe('office display labels', () => {
  it('names each seat without exposing worker identifiers', () => {
    expect(['collections', 'payables', 'vendor_onboarding', 'human', 'dana', 'demo:worker'].map(agentName))
      .toEqual(['Alex', 'Sam', 'Jules', 'Dana', 'Dana', 'Agent']);
  });
  it('keeps task descriptions, normalizes availability, and hides internal environment names', () => {
    expect(['offline', 'idle', '', 'disconnected', 'demo:worker', 'Sandbox preview', 'Synthetic work'].map(agentState))
      .toEqual(['Away', 'Idle', 'Idle', 'Away', 'Idle', 'Idle', 'Idle']);
    expect(agentState('Reviewing invoice 1042')).toBe('Reviewing invoice 1042');
  });
});

it('hides legacy idle seats while role handoffs are active, preserving escalations', async () => {
  const { visibleSeatAgents } = await import('./agent-labels');
  const { INITIAL_OFFICE } = await import('./state');
  const agent = { id: 'alex', name: 'Alex', state: 'Idle', seatId: 'collections' as const, targetAnchor: 'collections' as const, pos: [0, 0] as const };
  const handoffs = [{ status: 'accepted' }] as import('./handoffs').Handoff[];
  expect(visibleSeatAgents({ ...INITIAL_OFFICE, agents: [agent], handoffs })).toEqual([]);
  expect(visibleSeatAgents({ ...INITIAL_OFFICE, agents: [agent] })).toEqual([agent]);
  expect(visibleSeatAgents({ ...INITIAL_OFFICE, agents: [{ ...agent, escalationId: 'review:1' }], handoffs })).toHaveLength(1);
});
