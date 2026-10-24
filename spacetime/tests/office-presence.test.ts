import { describe, expect, it } from 'vitest';
import { ConnectionId, ScheduleAt, Timestamp } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import schema, * as reducers from '../src/index';
import { normalizeOfficePresence, OFFICE_PRESENCE_SWEEP } from '../src/office-presence';

const input = { viewerId: 'viewer-123', name: 'Guest', x: 0, z: 0, yaw: 0, mode: 'play' };
const caller = (id: number) => TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub: `viewer-${id}`, aud: 'backroom' }), new ConnectionId(BigInt(id)));
function setup() {
  const h = createModuleTestHarness(schema, reducers);
  const auth = caller(1);
  const at = (ms: number) => h.clock.set(new Timestamp(BigInt(ms) * 1000n));
  at(0);
  const upsert = (value = input, who = auth) => h.withReducerTx(who, ctx => reducers.office_presence_upsert(ctx, value));
  const leave = (viewerId = input.viewerId, who = auth) => h.withReducerTx(who, ctx => reducers.office_presence_leave(ctx, { viewerId }));
  const sweep = (who = TestAuth.internal()) => h.withReducerTx(who, ctx => reducers.office_presence_sweep(ctx, {
    schedule: { scheduledId: 1n, scheduledAt: ScheduleAt.interval(OFFICE_PRESENCE_SWEEP) },
  }));
  return { h, auth, at, upsert, leave, sweep };
}

describe('presence validation', () => {
  it('sanitizes display names, clamps the floor, and wraps yaw', () => {
    const normalized = normalizeOfficePresence({ ...input, name: '\n\x00 Guest\x85 ', x: -100, z: 100, yaw: 9 * Math.PI / 2 });
    expect(normalized).toMatchObject({ name: 'Guest', x: -8, z: 5.5 });
    expect(normalized.yaw).toBeCloseTo(Math.PI / 2);
    for (const yaw of [Math.PI, -Math.PI, 1e30, -1e30]) {
      const stored = Math.fround(normalizeOfficePresence({ ...input, yaw }).yaw);
      expect(stored).toBeGreaterThanOrEqual(-Math.PI);
      expect(stored).toBeLessThanOrEqual(Math.PI);
    }
    expect(normalizeOfficePresence({ ...input, name: 'x'.repeat(40) }).name).toHaveLength(24);
    expect(normalizeOfficePresence({ ...input, name: '\n\x7f  ' }).name).toBe('Viewer');
    expect(normalizeOfficePresence({ ...input, x: 100, z: -100, yaw: -9 * Math.PI / 2 })).toMatchObject({ x: 8, z: -5.5 });
    for (const viewerId of ['a'.repeat(8), 'A1-'.repeat(21) + 'z']) expect(normalizeOfficePresence({ ...input, viewerId }).viewerId).toBe(viewerId);
  });
  it('rejects malformed ids, modes, and all nonfinite positions', () => {
    for (const viewerId of ['', 'short', 'a'.repeat(65), 'viewer_bad', 'viewer-🎈', 'viewer-ok\n']) expect(() => normalizeOfficePresence({ ...input, viewerId })).toThrow('INVALID_VIEWER_ID');
    for (const mode of ['admin', '', 'PLAY']) expect(() => normalizeOfficePresence({ ...input, mode })).toThrow('INVALID_PRESENCE_MODE');
    for (const field of ['x', 'z', 'yaw']) for (const value of [NaN, Infinity, -Infinity])
      expect(() => normalizeOfficePresence({ ...input, [field]: value })).toThrow('INVALID_PRESENCE_POSITION');
  });
});

describe('anonymous visual presence reducers', () => {
  it('stores only public display fields, takes server time, and starts one private 5s schedule', () => {
    const { h, at, upsert } = setup();
    at(1234); upsert({ ...input, name: '\x00\n ', x: 30, z: -30 });
    expect(h.db.office_presence.viewerId.find(input.viewerId)).toEqual({ ...input, name: 'Viewer', x: 8, z: -5.5, at: 1234n });
    expect(h.db.office_presence_owner.viewerId.find(input.viewerId)?.owner).toBeDefined();
    expect(schema.schemaType.tables.office_presence.tableDef.tableAccess.tag).toBe('Public');
    expect(schema.schemaType.tables.office_presence_owner.tableDef.tableAccess.tag).toBe('Private');
    expect(schema.schemaType.tables.office_presence_schedule.tableDef.tableAccess.tag).toBe('Private');
    expect([...h.db.office_presence_schedule.iter()]).toHaveLength(1);
    expect([...h.db.office_presence_schedule.iter()][0]?.scheduledAt).toEqual(ScheduleAt.interval(5_000_000n));
    upsert({ ...input, viewerId: 'viewer-456' });
    expect(h.db.office_presence_schedule.count()).toBe(1n);
    expect(h.db.audit_entry.count()).toBe(0n);
    expect(h.db.agent.count()).toBe(0n);
  });
  it('validates on the server and rolls back invalid writes', () => {
    const { h, upsert, leave } = setup();
    expect(() => upsert({ ...input, viewerId: 'bad' })).toThrow('INVALID_VIEWER_ID');
    expect(() => upsert({ ...input, x: NaN })).toThrow('INVALID_PRESENCE_POSITION');
    expect(() => upsert({ ...input, mode: 'admin' })).toThrow('INVALID_PRESENCE_MODE');
    expect(() => leave('bad')).toThrow('INVALID_VIEWER_ID');
    expect(h.db.office_presence.count()).toBe(0n);
    expect(h.db.office_presence_owner.count()).toBe(0n);
  });
  it('rejects another caller even inside the rate window and removes both rows on leave', () => {
    const { h, at, upsert, leave } = setup();
    upsert();
    expect(() => upsert({ ...input, x: 1 }, caller(2))).toThrow('PRESENCE_NOT_OWNER');
    expect(() => leave(input.viewerId, caller(2))).toThrow('PRESENCE_NOT_OWNER');
    at(200); upsert({ ...input, x: 2 });
    expect(h.db.office_presence.viewerId.find(input.viewerId)?.x).toBe(2);
    leave(); leave();
    expect(h.db.office_presence.count()).toBe(0n);
    expect(h.db.office_presence_owner.count()).toBe(0n);
    upsert(input, caller(2)); // A departed random id can be claimed again.
    expect(h.db.office_presence.count()).toBe(1n);
  });
  it('ignores updates under 200ms without extending TTL, accepting the boundary', () => {
    const { h, at, upsert } = setup();
    upsert();
    at(199); upsert({ ...input, x: 2 });
    expect(h.db.office_presence.viewerId.find(input.viewerId)).toMatchObject({ x: 0, at: 0n });
    at(200); upsert({ ...input, x: 2 });
    expect(h.db.office_presence.viewerId.find(input.viewerId)).toMatchObject({ x: 2, at: 200n });
  });
  it('caps new rows at 32 while permitting owner updates and reuse of a freed slot', () => {
    const { h, at, upsert, leave } = setup();
    for (let i = 0; i < 32; i++) upsert({ ...input, viewerId: `viewer-${i}` });
    expect(() => upsert()).toThrow('PRESENCE_FULL');
    expect(h.db.office_presence_owner.count()).toBe(32n);
    expect(h.db.office_presence_owner.viewerId.find(input.viewerId)).toBeNull();
    at(200); upsert({ ...input, viewerId: 'viewer-0', x: 1 });
    expect(h.db.office_presence.viewerId.find('viewer-0')?.x).toBe(1);
    leave('viewer-0'); upsert();
    expect(h.db.office_presence.count()).toBe(32n);
  });
  it('sweeps strictly older than 15s, removes owners, and refuses client-triggered sweeps', () => {
    const { h, auth, at, upsert, sweep } = setup();
    upsert();
    at(1000); upsert({ ...input, viewerId: 'viewer-fresh' });
    at(15000); sweep();
    expect(h.db.office_presence.count()).toBe(2n);
    at(15001);
    expect(() => sweep(auth)).toThrow('SCHEDULE_ONLY');
    sweep();
    expect(h.db.office_presence.viewerId.find(input.viewerId)).toBeNull();
    expect(h.db.office_presence_owner.viewerId.find(input.viewerId)).toBeNull();
    expect(h.db.office_presence.viewerId.find('viewer-fresh')).not.toBeNull();
    upsert(input, caller(2));
    expect(h.db.office_presence.count()).toBe(2n);
  });
  it('sweeps every expired row and owner, freeing all capped slots', () => {
    const { h, at, upsert, sweep } = setup();
    for (let i = 0; i < 32; i++) upsert({ ...input, viewerId: `viewer-${i}` });
    at(20_000); sweep();
    expect(h.db.office_presence.count()).toBe(0n);
    expect(h.db.office_presence_owner.count()).toBe(0n);
    upsert();
    expect(h.db.office_presence.count()).toBe(1n);
    expect(h.db.office_presence_schedule.count()).toBe(1n);
  });
});
