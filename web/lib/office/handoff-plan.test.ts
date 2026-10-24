import { afterEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_AGENTS, handoffSpot, type Handoff } from './handoffs';
import { CHECK_MS, HandoffStage, PASS_MS, actorAt, nextChange, planHandoffs, sampleHandoffs } from './handoff-plan';
import { MOCK_HANDOFF_SCRIPT, createMockHandoffFeed, mockCycleRows } from './handoff-mock';

function row(id: string, from: string, to: string, at: number, status: Handoff['status'] = 'accepted', extra: Partial<Handoff> = {}): Handoff {
  return { id, from, to, item: `item-${id}`, summary: `summary ${id}`, status, at, ...extra };
}
const near = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-6;

describe('planHandoffs', () => {
  it('walks the sender to the receiver, passes the folder and walks home', () => {
    const plan = planHandoffs([row('a', 'intake', 'payables', 1000)]);
    const [trip] = plan.trips;
    expect(trip).toMatchObject({ courier: 'intake', receiver: 'payables', start: 1000 });
    expect(near(actorAt(plan, 'intake', 999).position, HANDOFF_AGENTS.intake.station)).toBe(true);
    const mid = actorAt(plan, 'intake', (trip!.start + trip!.arrive) / 2);
    expect(mid.moving).toBe(true);
    expect(near(actorAt(plan, 'intake', trip!.arrive + 1).position, handoffSpot('payables'))).toBe(true);
    expect(near(actorAt(plan, 'intake', trip!.end + 1).position, HANDOFF_AGENTS.intake.station)).toBe(true);
    // The folder rides with the courier, then crosses to the receiver during the pass.
    const carried = sampleHandoffs(plan, (trip!.start + trip!.arrive) / 2).folders;
    expect(carried).toHaveLength(1);
    const passing = sampleHandoffs(plan, trip!.arrive + PASS_MS / 2).folders[0]!;
    expect(passing.position[1]).toBeGreaterThan(0.95);
    expect(sampleHandoffs(plan, trip!.end + 1).folders).toEqual([]);
  });

  it('shows the summary as a speech bubble from arrival through the pass', () => {
    const plan = planHandoffs([row('a', 'intake', 'extractor', 0)]);
    const { arrive } = plan.trips[0]!;
    expect(sampleHandoffs(plan, arrive + 10).bubbles).toEqual([expect.objectContaining({ actor: 'intake', text: 'summary a', tone: 'info' })]);
    expect(sampleHandoffs(plan, arrive + PASS_MS + 5000).bubbles).toEqual([]);
  });

  it('queues handoffs that share an agent', () => {
    const plan = planHandoffs([row('a', 'intake', 'extractor', 0), row('b', 'intake', 'extractor', 100)]);
    const [first, second] = plan.trips;
    expect(second!.start).toBeGreaterThanOrEqual(first!.end);
    // Never in two places: legs of one actor do not overlap.
    const legs = plan.legs.filter(leg => leg.actor === 'intake').sort((x, y) => x.start - y.start);
    for (let i = 1; i < legs.length; i++) expect(legs[i]!.start).toBeGreaterThanOrEqual(legs[i - 1]!.end - 1e-9);
  });

  it('runs handoffs between different agents at the same time', () => {
    const plan = planHandoffs([row('a', 'intake', 'extractor', 0), row('b', 'collections', 'auditor', 0)]);
    expect(plan.trips.map(trip => trip.start)).toEqual([0, 0]);
    const frame = sampleHandoffs(plan, 300);
    expect(frame.actors.filter(actor => actor.moving).map(actor => actor.id).sort()).toEqual(['collections', 'intake']);
    expect(frame.animating).toBe(true);
  });

  it('waits for a busy receiver before handing over', () => {
    const plan = planHandoffs([row('a', 'payables', 'reconciler', 0, 'failed'), row('b', 'auditor', 'reconciler', 10)]);
    const [failed, next] = plan.trips;
    expect(next!.start).toBeGreaterThanOrEqual(failed!.end);
  });

  it('sends a failed folder back: the receiver checks it and walks it to the sender', () => {
    const plan = planHandoffs([row('f', 'extractor', 'vendor_verifier', 0, 'failed')]);
    const { arrive, end } = plan.trips[0]!;
    const back = plan.legs.find(leg => leg.actor === 'vendor_verifier' && leg.returning)!;
    expect(back.start).toBeCloseTo(arrive + PASS_MS + CHECK_MS);
    expect(back.route.at(-1)).toEqual(handoffSpot('extractor'));
    const returning = sampleHandoffs(plan, (back.start + back.end) / 2);
    expect(returning.actors.find(actor => actor.id === 'vendor_verifier')).toMatchObject({ moving: true, returning: true });
    expect(returning.folders).toEqual([expect.objectContaining({ handoffId: 'f', failed: true })]);
    expect(returning.bubbles).toEqual(expect.arrayContaining([expect.objectContaining({ actor: 'vendor_verifier', tone: 'fail', text: '✕ summary f' })]));
    // Before the check fails the folder is not red, and the courier's bubble names the item rather than the failure.
    const handing = sampleHandoffs(plan, arrive + 10);
    expect(handing.folders[0]!.failed).toBe(false);
    expect(handing.bubbles[0]!.text).toBe('item-f → Vendor verifier');
    expect(near(actorAt(plan, 'vendor_verifier', end + 1).position, HANDOFF_AGENTS.vendor_verifier.station)).toBe(true);
  });

  it('plays a failure reported after the pass instead of hiding it in the past', () => {
    const first = planHandoffs([row('f', 'extractor', 'vendor_verifier', 0)]);
    const late = first.trips[0]!.end + 5000;
    const plan = planHandoffs([row('f', 'extractor', 'vendor_verifier', 0, 'failed', { updatedAt: late })]);
    const back = plan.legs.find(leg => leg.returning)!;
    expect(back.start).toBe(late);
  });

  it('only shows Dana at the passkey step and keeps her there until it resolves', () => {
    const waiting = planHandoffs([row('p', 'payables', 'human', 0, 'awaiting_passkey'), row('x', 'intake', 'extractor', 0)]);
    const { arrive } = waiting.trips[0]!;
    expect(sampleHandoffs(waiting, arrive - 1).human).toBe(false);
    expect(sampleHandoffs(waiting, arrive + 1).human).toBe(true);
    expect(sampleHandoffs(waiting, arrive + 600_000).human).toBe(true);
    expect(sampleHandoffs(waiting, arrive + 600_000).bubbles).toEqual([expect.objectContaining({ actor: 'human', tone: 'passkey' })]);
    const resolvedAt = arrive + 20_000;
    const resolved = planHandoffs([row('p', 'payables', 'human', 0, 'accepted', { updatedAt: resolvedAt })]);
    expect(sampleHandoffs(resolved, resolvedAt - 1).human).toBe(true);
    expect(sampleHandoffs(resolved, resolvedAt + 1).human).toBe(false);
    // No passkey row, no human.
    const plain = planHandoffs([row('x', 'intake', 'extractor', 0)]);
    expect(plain.human).toEqual([]);
  });

  it('has the courier carry a declined passkey folder back itself', () => {
    const plan = planHandoffs([row('d', 'payables', 'human', 0, 'failed')]);
    const back = plan.legs.find(leg => leg.actor === 'payables' && leg.returning)!;
    expect(back).toBeDefined();
    expect(sampleHandoffs(plan, (back.start + back.end) / 2).folders[0]).toMatchObject({ failed: true });
    expect(plan.legs.some(leg => leg.actor === 'human')).toBe(false);
  });

  it('collects a folder from Dana when she hands one back', () => {
    const plan = planHandoffs([row('r', 'human', 'payables', 0)]);
    expect(plan.trips[0]).toMatchObject({ courier: 'payables', receiver: 'human' });
    expect(plan.human).toHaveLength(1);
  });

  it('skips rows it cannot draw but keeps planning the rest', () => {
    const plan = planHandoffs([row('u', 'mystery', 'payables', 0), row('s', 'payables', 'payables', 0), row('ok', 'intake', 'extractor', 0)]);
    expect(plan.skipped).toEqual(['s', 'u']);
    expect(plan.trips).toHaveLength(1);
  });

  it('snaps everything for reduced motion: agents stay home, no folders fly, bubbles and Dana still show', () => {
    const plan = planHandoffs([row('p', 'payables', 'human', 0, 'awaiting_passkey')]);
    const { start, arrive } = plan.trips[0]!;
    const frame = sampleHandoffs(plan, (start + arrive) / 2, { reduced: true });
    expect(frame.actors.every(actor => !actor.moving)).toBe(true);
    expect(near(frame.actors.find(actor => actor.id === 'payables')!.position, HANDOFF_AGENTS.payables.station)).toBe(true);
    expect(frame.folders).toEqual([]);
    expect(frame.animating).toBe(false);
    expect(sampleHandoffs(plan, arrive + 10, { reduced: true }).bubbles.length).toBe(1);
  });

  it('reports the next static change so an on-demand renderer can wake up', () => {
    const plan = planHandoffs([row('a', 'intake', 'extractor', 5000)]);
    expect(nextChange(plan, 0)).toBe(5000);
    expect(nextChange(plan, plan.trips[0]!.end + 1e6)).toBeNull();
  });

  it('is deterministic and independent of row order', () => {
    const rows = [row('b', 'intake', 'extractor', 10), row('a', 'intake', 'extractor', 10), row('c', 'collections', 'auditor', 0)];
    expect(planHandoffs(rows)).toEqual(planHandoffs([...rows].reverse()));
  });

  it('speeds up walks and passes with the speed option', () => {
    const slow = planHandoffs([row('a', 'intake', 'payables', 0)]).trips[0]!;
    const fast = planHandoffs([row('a', 'intake', 'payables', 0)], { speed: 4 }).trips[0]!;
    expect(fast.end).toBeCloseTo(slow.end / 4);
  });
});

describe('HandoffStage', () => {
  it('re-plans only when the row array changes', () => {
    const stage = new HandoffStage();
    const rows = [row('a', 'intake', 'extractor', 0)];
    expect(stage.update(rows)).toBe(true);
    expect(stage.update(rows)).toBe(false);
    expect(stage.handoffFor('extractor', 0)?.id).toBe('a');
    expect(stage.update([])).toBe(true);
    expect(stage.plan.trips).toEqual([]);
  });
});

describe('mock handoff feed', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('covers a queue, an overlap, a failure and the passkey step, and every row is drawable', () => {
    const rows = mockCycleRows(0, 0, Infinity);
    expect(rows).toHaveLength(MOCK_HANDOFF_SCRIPT.length);
    const plan = planHandoffs(rows);
    expect(plan.skipped).toEqual([]);
    expect(plan.legs.some(leg => leg.returning)).toBe(true);
    expect(plan.human.length).toBe(1);
    expect(rows.find(entry => entry.to === 'human')).toMatchObject({ status: 'accepted', updatedAt: 52_000 });
    // The cycle finishes before the next one starts, so loops do not pile up.
    expect(Math.max(...plan.trips.map(trip => trip.end))).toBeLessThan(64_000);
  });
  it('emits rows over time and resolves the passkey row later', () => {
    vi.useFakeTimers({ now: 0 });
    const feed = createMockHandoffFeed({ lead: 0 });
    const seen: number[] = [];
    feed.subscribe(() => seen.push(feed.getRows().length));
    feed.start();
    vi.advanceTimersByTime(100);
    expect(feed.getRows().map(entry => entry.id)).toEqual(['mock-0-1', 'mock-0-2']);
    vi.advanceTimersByTime(6000);
    expect(feed.getRows().find(entry => entry.to === 'human')?.status).toBe('awaiting_passkey');
    vi.advanceTimersByTime(50_000);
    expect(feed.getRows().find(entry => entry.to === 'human')?.status).toBe('accepted');
    vi.advanceTimersByTime(10_000);
    expect(feed.getRows().some(entry => entry.id === 'mock-1-1')).toBe(true);
    feed.stop();
    expect(seen.length).toBeGreaterThan(3);
  });
});
