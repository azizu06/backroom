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
