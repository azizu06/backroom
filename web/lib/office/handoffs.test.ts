import { describe, expect, it } from 'vitest';
import {
  FLOOR_AGENTS, HANDOFF_AGENTS, handoffFlag, handoffFromRow, handoffLine, handoffRoute, handoffSpot, normalizeStatus,
  type HandoffAgentId,
} from './handoffs';
import { FLOOR, insideAny, officeColliders } from './play';
import { OFFICE_ANCHORS, type AnchorId } from './state';

const colliders = officeColliders(Object.keys(OFFICE_ANCHORS) as AnchorId[]);
const ALL = Object.keys(HANDOFF_AGENTS) as HandoffAgentId[];
const CLEARANCE = 0.2;

function samples(route: readonly (readonly [number, number])[]) {
  const points: [number, number][] = [];
  for (let i = 1; i < route.length; i++) {
    const [a, b] = [route[i - 1]!, route[i]!];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
    for (let s = 0; s <= steps; s++) points.push([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps]);
  }
  return points;
}

describe('handoff layout', () => {
  it('keeps every station and handoff spot clear of the office colliders', () => {
    for (const id of ALL) {
      expect(insideAny(HANDOFF_AGENTS[id].station, colliders, CLEARANCE), `${id} station`).toBe(false);
      expect(insideAny(handoffSpot(id), colliders, CLEARANCE), `${id} spot`).toBe(false);
    }
  });
  it('walks every pair along paths that stay on the floor and clear of furniture, doors and walls', () => {
    for (const from of ALL) for (const to of ALL) {
      if (from === to) continue;
      const route = handoffRoute(from, to);
      expect(route[0]).toEqual(HANDOFF_AGENTS[from].station);
      expect(route.at(-1)).toEqual(handoffSpot(to));
      for (const point of samples(route)) {
        expect(insideAny(point, colliders, CLEARANCE), `${from}→${to} at ${point.map(v => v.toFixed(2))}`).toBe(false);
        expect(point[0]).toBeGreaterThan(FLOOR.minX);
        expect(point[0]).toBeLessThan(FLOOR.maxX);
      }
    }
  });
  it('crosses rooms through the central aisle and stays inside a shared room', () => {
    expect(handoffRoute('intake', 'payables').some(([, z]) => z === 0.6)).toBe(true);
    expect(handoffRoute('intake', 'extractor')).toHaveLength(2);
  });
  it('draws seven floor agents and keeps Dana off the floor list', () => {
    expect(FLOOR_AGENTS).toEqual(['intake', 'extractor', 'auditor', 'collections', 'reconciler', 'payables', 'vendor_verifier']);
  });
});

describe('handoff adapter (provisional contract)', () => {
  it('maps a provisional row and normalizes agents, statuses and timestamps', () => {
    expect(handoffFromRow({ id: 7n, from_agent: 'Vendor Verifier', to_agent: 'payables', item_id: 'INV-1', summary: 'ok', status: 'done', created_at: { microsSinceUnixEpoch: 1_700_000_000_000_000n } }))
      .toEqual({ id: '7', from: 'vendor_verifier', to: 'payables', item: 'INV-1', summary: 'ok', status: 'accepted', at: 1_700_000_000_000 });
    expect(handoffFromRow({ id: 'h', from: 'payables', to: 'Dana', item: 'x', summary: 's', status: 'needs-passkey', at: 5, updatedAt: 9 }))
      .toMatchObject({ to: 'human', status: 'awaiting_passkey', at: 5, updatedAt: 9 });
  });
  it('drops rows without an id or endpoints and defaults unknown statuses to pending', () => {
    expect(handoffFromRow({ from: 'a', to: 'b' })).toBeNull();
    expect(handoffFromRow({ id: 1, from: '', to: 'b' })).toBeNull();
    expect(normalizeStatus('???')).toBe('pending');
    expect(handoffFromRow({ id: 1, from: 'a', to: 'b' }, 42)).toMatchObject({ at: 42, status: 'pending' });
  });
  it('writes one readable log line per handoff', () => {
    expect(handoffLine({ id: '1', from: 'extractor', to: 'vendor_verifier', item: 'INV-1042', summary: 'Account mismatch', status: 'failed', at: 0 }))
      .toBe('Extractor → Vendor verifier · INV-1042: Account mismatch · check failed, returned');
    expect(handoffLine({ id: '2', from: 'payables', to: 'human', item: '', summary: 'Pay', status: 'awaiting_passkey', at: 0 }))
      .toBe('Payables → Dana: Pay · waiting for Dana’s passkey');
  });
  it('reads the mock flag and clamps the speed', () => {
    expect(handoffFlag('?handoffs=mock')).toEqual({ mock: true, speed: 1 });
    expect(handoffFlag('?handoffs=mock&handoffSpeed=20')).toEqual({ mock: true, speed: 8 });
    expect(handoffFlag('?handoffs=live&handoffSpeed=x')).toEqual({ mock: false, speed: 1 });
  });
});
