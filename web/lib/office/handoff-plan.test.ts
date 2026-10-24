import { afterEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_AGENTS, handoffSpot, type Handoff, type HandoffRole } from './handoffs';
import { HandoffStage, PASS_MS, actorAt, nextChange, planHandoffs, sampleHandoffs } from './handoff-plan';
import { MOCK_HANDOFF_SCRIPT, createMockHandoffFeed, mockCycleRows } from './handoff-mock';

function row(id: string, from: HandoffRole, to: HandoffRole, createdAt = 0, extra: Partial<Handoff> = {}): Handoff {
  return { handoffId: id, sequence: BigInt(createdAt), caseDisplayId: `INV-${id}`, fromAgentId: `${from}-agent`, toAgentId: `${to}-agent`,
    fromRole: from, toRole: to, fromVoiceRole: from, toVoiceRole: to, reason: `Reason ${id}`, summary: `Summary ${id}`, line: `Line ${id}`,
    status: 'completed', correction: false, createdAt, ...extra };
}
const position = (stage: HandoffStage, now: number) => stage.sample(now).actors.find(actor => actor.id === 'intake')!.position;

describe('public handoff choreography', () => {
  it('walks the sender to the receiver, passes the folder and walks home', () => {
    const plan = planHandoffs([row('a', 'intake', 'payables', 1000)]), trip = plan.trips[0]!;
    expect(actorAt(plan, 'intake', 999).position).toEqual(HANDOFF_AGENTS.intake.station);
    expect(actorAt(plan, 'intake', trip.arrive + 1).position).toEqual(handoffSpot('payables'));
    expect(sampleHandoffs(plan, (trip.start + trip.arrive) / 2).folders).toHaveLength(1);
    expect(sampleHandoffs(plan, trip.arrive + PASS_MS / 2).folders[0]!.position[1]).toBeGreaterThan(.95);
    expect(sampleHandoffs(plan, (trip.start + trip.arrive) / 2).folders[0]!.carrier).toBe('intake');
    expect(sampleHandoffs(plan, trip.arrive + PASS_MS / 2).folders[0]!.carrier).toBeUndefined();
    expect(actorAt(plan, 'intake', trip.end + 1).position).toEqual(HANDOFF_AGENTS.intake.station);
    expect(sampleHandoffs(plan, trip.end + 1).folders).toEqual([]);
  });
  it('holds an offered folder until acceptance, then keeps it with the working receiver until completedAt', () => {
    const offered = planHandoffs([row('a', 'intake', 'extractor', 0, { status: 'offered' })]);
    const arrive = offered.trips[0]!.arrive;
    expect(actorAt(offered, 'intake', arrive + 100_000).position).toEqual(handoffSpot('extractor'));
    expect(offered.folders[0]!.segments).toEqual([{ kind: 'carry', actor: 'intake', start: 0, end: Infinity }]);
    const accepted = planHandoffs([row('a', 'intake', 'extractor', 0, { status: 'accepted', acceptedAt: 5000 })]);
    expect(accepted.folders[0]!.segments.at(-1)).toMatchObject({ kind: 'carry', actor: 'extractor', start: 5000 + PASS_MS, end: Infinity });
    const done = planHandoffs([row('a', 'intake', 'extractor', 0, { acceptedAt: 5000, completedAt: 10_000 })]);
    expect(sampleHandoffs(done, 9000).folders).toHaveLength(1);
    expect(sampleHandoffs(done, 10_000).folders).toEqual([]);
  });
  it('queues shared agents in sequence order and overlaps independent walks', () => {
    const plan = planHandoffs([row('a', 'intake', 'extractor'), row('b', 'intake', 'extractor', 100), row('c', 'collections', 'auditor')]);
    expect(plan.trips.find(t => t.handoff.handoffId === 'b')!.start).toBeGreaterThanOrEqual(plan.trips[0]!.end);
    expect(sampleHandoffs(plan, 300).actors.filter(a => a.moving).map(a => a.id).sort()).toEqual(['collections', 'intake']);
    expect(planHandoffs([...plan.trips.map(t => t.handoff)].reverse())).toEqual(plan);
  });
  it('returns a rejected folder with the sender, who keeps the case', () => {
    const plan = planHandoffs([row('r', 'extractor', 'vendor', 0, { status: 'rejected', errorCode: 'MISMATCH' })]);
    const back = plan.legs.find(leg => leg.returning)!;
    expect(back.actor).toBe('extractor');
    expect(back.route.at(-1)).toEqual(HANDOFF_AGENTS.extractor.station);
    expect(plan.legs.some(leg => leg.actor === 'vendor')).toBe(false);
    expect(plan.folders[0]!.segments.every(segment => segment.kind === 'carry' && segment.actor === 'extractor')).toBe(true);
    const frame = sampleHandoffs(plan, (back.start + back.end) / 2);
    expect(frame.folders[0]!.failed).toBe(true);
    expect(frame.bubbles[0]!.text).toContain('MISMATCH');
  });
  it('draws a correction as its own reverse trip with an amber cue and label', () => {
    const plan = planHandoffs([row('forward', 'vendor', 'payables'), row('reverse', 'payables', 'vendor', 10_000, { correction: true })]);
    const trip = plan.trips[1]!;
    expect(trip).toMatchObject({ courier: 'payables', receiver: 'vendor' });
    const frame = sampleHandoffs(plan, trip.start + 100);
    expect(frame.folders[0]).toMatchObject({ handoffId: 'reverse', correction: true, failed: false });
    expect(frame.bubbles[0]).toMatchObject({ tone: 'correction', text: expect.stringContaining('Correction') });
  });
  it('shows Dana only for explicit approval evidence or an open snapshot escalation', () => {
    for (const status of ['offered', 'accepted', 'completed', 'rejected'] as const) {
      expect(sampleHandoffs(planHandoffs([row('a', 'payables', 'reconciler', 0, { status })]), 5000).human).toBe(false);
    }
    const plan = planHandoffs([row('p', 'payables', 'reconciler', 1000, { reason: 'Human approval required', decisionRef: 'passkey:42', completedAt: 9000 })]);
    expect(sampleHandoffs(plan, 999).human).toBe(false);
    expect(sampleHandoffs(plan, 2000).human).toBe(true);
    expect(sampleHandoffs(plan, 20_000).human).toBe(false);
    expect(plan.trips[0]!.receiver).toBe('reconciler');
    const stage = new HandoffStage(), rows: Handoff[] = [];
    stage.update(rows, 0, true); expect(stage.sample(0).human).toBe(true);
    stage.update(rows, 10, false); expect(stage.sample(10).human).toBe(false);
  });
  it('keeps reduced motion static while preserving text and human evidence', () => {
    const plan = planHandoffs([row('p', 'payables', 'reconciler', 0, { reason: 'Escalation for passkey' })]);
    const frame = sampleHandoffs(plan, 100, { reduced: true });
    expect(frame.actors.every(actor => !actor.moving && actor.position.every((v, i) => v === HANDOFF_AGENTS[actor.id].station[i]))).toBe(true);
    expect(frame.folders).toEqual([]); expect(frame.animating).toBe(false); expect(frame.human).toBe(true);
    expect(frame.bubbles.length).toBeGreaterThan(0);
  });
  it('reports the next static change and scales the whole walk with speed', () => {
    const rows = [row('a', 'intake', 'payables', 5000)], plan = planHandoffs(rows);
    expect(nextChange(plan, 0)).toBe(5000);
    expect(nextChange(plan, plan.trips[0]!.end + 1e6)).toBeNull();
    expect(planHandoffs(rows, { speed: 4 }).trips[0]!.end - 5000).toBeCloseTo((plan.trips[0]!.end - 5000) / 4);
  });
});

describe('HandoffStage status continuity', () => {
  it.each(['accepted', 'completed'] as const)('keeps start time and position when offered becomes %s mid-walk', status => {
    const stage = new HandoffStage(), initial = row('a', 'intake', 'payables', 1000, { status: 'offered' });
    stage.update([initial], 1000);
    const now = 2000, before = position(stage, now), outbound = stage.plan.legs[0];
    stage.update([{ ...initial, status, acceptedAt: 1800, ...(status === 'completed' ? { completedAt: 1900 } : {}) }], now);
    expect(position(stage, now)).toEqual(before);
    expect(stage.plan.legs[0]).toEqual(outbound);
    expect(stage.plan.trips[0]!.start).toBe(1000);
    expect(position(stage, now + 1)).not.toEqual(before);
  });
  it('keeps an existing homeward walk continuous on late completion with a changed acceptedAt', () => {
    const stage = new HandoffStage(), initial = row('a', 'intake', 'payables', 1000, { status: 'accepted', acceptedAt: 5000 });
    stage.update([initial], 1000);
    const home = stage.plan.legs.find(leg => leg.phase === 'home')!, now = home.start + 200, before = position(stage, now);
    stage.update([{ ...initial, status: 'completed', acceptedAt: now, completedAt: now }], now);
    expect(position(stage, now)).toEqual(before);
    expect(stage.plan.legs.find(leg => leg.phase === 'home')).toEqual(home);
  });
  it('starts a rejected return at the carrier’s current position, and preserves it on later updates', () => {
    const stage = new HandoffStage(), initial = row('a', 'intake', 'payables', 1000, { status: 'offered' });
    stage.update([initial], 1000);
    const now = 2200, before = position(stage, now), rejected = { ...initial, status: 'rejected' as const, errorCode: 'CASE_STOPPED' };
    stage.update([rejected], now);
    const back = stage.plan.legs.find(leg => leg.phase === 'home')!;
    position(stage, now).forEach((value, i) => expect(value).toBeCloseTo(before[i]!, 10));
    expect(back.start).toBe(now); back.route[0]!.forEach((value, i) => expect(value).toBeCloseTo(before[i]!, 10));
    expect(back.route.at(-1)).toEqual(HANDOFF_AGENTS.intake.station);
    expect(stage.sample(now).folders[0]!.failed).toBe(true);
    const later = now + 100, returning = position(stage, later);
    stage.update([{ ...rejected, completedAt: later }], later);
    expect(position(stage, later)).toEqual(returning);
    expect(position(stage, back.end + 1)).toEqual(HANDOFF_AGENTS.intake.station);
  });
  it('leaves a carrier who is already home in place on a late rejection', () => {
    const stage = new HandoffStage(), initial = row('a', 'intake', 'payables');
    stage.update([initial], 0);
    const now = stage.plan.trips[0]!.end + 100;
    stage.update([{ ...initial, status: 'rejected', errorCode: 'LATE' }], now);
    expect(position(stage, now)).toEqual(HANDOFF_AGENTS.intake.station);
    expect(position(stage, now + 100)).toEqual(HANDOFF_AGENTS.intake.station);
  });
  it('returns an offered folder from the receiving desk when stopped before acceptance', () => {
    const stage = new HandoffStage(), initial = row('a', 'intake', 'payables', 0, { status: 'offered' });
    stage.update([initial], 0);
    const now = stage.plan.trips[0]!.arrive + 1000, before = position(stage, now);
    stage.update([{ ...initial, status: 'rejected', errorCode: 'CASE_STOPPED' }], now);
    expect(position(stage, now)).toEqual(before);
    const back = stage.plan.legs.find(leg => leg.phase === 'home')!;
    expect(back).toMatchObject({ actor: 'intake', start: now, returning: true });
    expect(back.route[0]).toEqual(handoffSpot('payables'));
    expect(back.route.at(-1)).toEqual(HANDOFF_AGENTS.intake.station);
  });
  it.each(['during pass', 'A walking home', 'A home'])('returns an accepted folder from B after CASE_STOPPED (%s)', timing => {
    const stage = new HandoffStage(), initial = row('a', 'intake', 'payables', 0, { status: 'accepted', acceptedAt: 0 });
    stage.update([initial], 0);
    const delivery = stage.plan.folders[0]!.segments.find(segment => segment.kind === 'pass')!;
    const now = timing === 'during pass' ? delivery.start + PASS_MS / 2
      : timing === 'A walking home' ? delivery.end + 100 : stage.plan.trips[0]!.end + 100;
    const before = stage.sample(now);
    const rejected = { ...initial, status: 'rejected' as const, errorCode: 'CASE_STOPPED' };
    stage.update([rejected], now);
    for (const id of ['intake', 'payables']) {
      expect(stage.sample(now).actors.find(actor => actor.id === id)!.position).toEqual(before.actors.find(actor => actor.id === id)!.position);
    }
    expect(stage.sample(now).folders[0]!.position).toEqual(before.folders[0]!.position);
    const back = stage.plan.legs.find(leg => leg.phase === 'return')!;
    expect(back).toMatchObject({ actor: 'payables', start: Math.max(now, delivery.end), returning: true });
    expect(back.route[0]).toEqual(HANDOFF_AGENTS.payables.station);
    expect(back.route.at(-1)).toEqual(handoffSpot('intake'));
    const midpoint = (back.start + back.end) / 2, returning = stage.sample(midpoint);
    expect(returning.actors.find(actor => actor.id === 'payables')).toMatchObject({ moving: true, returning: true });
    expect(returning.folders[0]!.failed).toBe(true);
    stage.update([{ ...rejected, completedAt: midpoint }], midpoint);
    expect(stage.sample(midpoint).actors).toEqual(returning.actors);
    expect(stage.sample(midpoint).folders).toEqual(returning.folders);
    expect(stage.plan.legs.find(leg => leg.phase === 'return')).toEqual(back);
    const reduced = stage.sample(midpoint, true);
    expect(reduced.animating).toBe(false); expect(reduced.folders).toEqual([]);
    expect(stage.sample(stage.plan.trips[0]!.end + 1).actors.find(actor => actor.id === 'payables')!.position).toEqual(HANDOFF_AGENTS.payables.station);
  });
  it('handles a separate rejected row alongside an earlier completed row', () => {
    const first = row('first', 'intake', 'payables', 0, { caseDisplayId: 'INV-1' });
    const rejected = row('separate', 'payables', 'vendor', 20_000, { caseDisplayId: 'INV-1', status: 'rejected', errorCode: 'CASE_STOPPED' });
    const stage = new HandoffStage(); stage.update([first], 0); stage.update([first, rejected], 20_000);
    expect(stage.plan.trips.map(trip => trip.handoff.handoffId)).toEqual(['first', 'separate']);
    const back = stage.plan.legs.find(leg => leg.handoffId === 'separate' && leg.phase === 'home')!;
    expect(back.returning).toBe(true); expect(back.route.at(-1)).toEqual(HANDOFF_AGENTS.payables.station);
  });
  it('does not move an in-flight queued trip when earlier rows finish or disappear', () => {
    const first = row('first', 'intake', 'extractor'), second = row('second', 'intake', 'payables', 100);
    const stage = new HandoffStage(); stage.update([first, second], 0);
    const now = stage.plan.trips[1]!.start + 100, before = position(stage, now);
    stage.update([second], now);
    expect(position(stage, now)).toEqual(before);
  });
  it('only re-plans when rows or the escalation signal change', () => {
    const stage = new HandoffStage(), rows = [row('a', 'intake', 'extractor')];
    expect(stage.update(rows, 0)).toBe(true); expect(stage.update(rows, 1)).toBe(false);
    expect(stage.handoffFor('extractor', 0)?.handoffId).toBe('a');
    stage.update([], 2); expect(stage.plan.trips).toEqual([]);
  });
});

describe('mock handoff feed', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('covers in-place status progression, rejection, reverse correction and a payables escalation', () => {
    const early = mockCycleRows(0, 0, 0), accepted = mockCycleRows(0, 0, 3000), final = mockCycleRows(0, 0, Infinity);
    expect(early[0]).toMatchObject({ handoffId: 'mock-0-1', status: 'offered' });
    expect(accepted[0]).toMatchObject({ handoffId: 'mock-0-1', status: 'accepted', acceptedAt: 2500 });
    expect(final[0]).toMatchObject({ handoffId: 'mock-0-1', status: 'completed', completedAt: 5000 });
    expect(final).toHaveLength(MOCK_HANDOFF_SCRIPT.length);
    expect(final.find(r => r.status === 'rejected')?.errorCode).toBe('VENDOR_MISMATCH');
    expect(final.find(r => r.correction)).toMatchObject({ fromRole: 'payables', toRole: 'vendor' });
    const plan = planHandoffs(final);
    expect(plan.skipped).toEqual([]); expect(sampleHandoffs(plan, 43_000).human).toBe(true);
    expect(Math.max(...plan.trips.map(t => t.end))).toBeLessThan(64_000);
  });
  it('emits immutable rows, scales timestamps and loops with distinct ids and increasing sequences', () => {
    vi.useFakeTimers({ now: 0 });
    const feed = createMockHandoffFeed({ lead: 0, speed: 4 });
    const listener = vi.fn(); feed.subscribe(listener); feed.start();
    const first = feed.getRows()[0]!;
    vi.advanceTimersByTime(650);
    expect(first.status).toBe('offered');
    expect(feed.getRows()[0]).toMatchObject({ handoffId: first.handoffId, status: 'accepted', acceptedAt: 625 });
    vi.advanceTimersByTime(16_000);
    const next = feed.getRows().find(r => r.handoffId === 'mock-1-1')!;
    expect(next.sequence > first.sequence).toBe(true); expect(next.createdAt).toBe(16_000);
    feed.stop(); const calls = listener.mock.calls.length;
    vi.advanceTimersByTime(1000); expect(listener).toHaveBeenCalledTimes(calls);
  });
});
