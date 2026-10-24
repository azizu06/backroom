import { describe, expect, it } from 'vitest';
import { disclosureItems, getDisclosureStatus } from './real-vs-sim';

describe('demo disclosure status', () => {
  it('does not claim live services are online without evidence', () => {
    for (const item of disclosureItems.filter(item => item.kind === 'real')) {
      expect(getDisclosureStatus(item, null).label).toBe('Unverified');
    }
  });
});

const snapshot = (overrides = {}): import('./real-vs-sim').DemoStatus => ({
  measuredAt: new Date().toISOString(), llmEnabled: true, gx10: null, ...overrides,
});
const gx10 = disclosureItems.find(item => item.id === 'gx10')!;

it('never mistakes the router optimistic initial state for an observed online model', () => {
  expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: true, localAvailable: true, checkedAt: null } })).label).toBe('Unverified');
});

it.each([true, false])('reports observed GX10 availability %s', available => {
  expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: true, localAvailable: available, checkedAt: new Date().toISOString() } })).label).toBe(available ? 'Online' : 'Offline');
});

it('shows OFF for model-dependent integrations while preserving sandbox disclosure', () => {
  for (const id of ['phone', 'claude', 'gx10']) {
    expect(getDisclosureStatus(disclosureItems.find(item => item.id === id)!, snapshot({ llmEnabled: false })).label).toBe('LLM OFF');
  }
  expect(getDisclosureStatus(disclosureItems.find(item => item.id === 'nessie')!, snapshot({ llmEnabled: false })).label).toBe('Simulated');
});

it('discards stale status snapshots and stale health observations', () => {
  const old = new Date(Date.now() - 60_000).toISOString();
  expect(getDisclosureStatus(gx10, snapshot({ measuredAt: old, llmEnabled: false })).label).toBe('Unverified');
  expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: true, localAvailable: true, checkedAt: old } })).label).toBe('Unverified');
});

it('distinguishes a disabled local model from an offline one', () => {
  expect(getDisclosureStatus(gx10, snapshot({ gx10: { localEnabled: false, localAvailable: false, checkedAt: null } })).label).toBe('Disabled');
});
