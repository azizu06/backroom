import { afterEach, describe, expect, it, vi } from 'vitest';
import { DbConnection } from '@backroom/orchestrator/spacetime-client';
import type { OfficePresence } from '@backroom/orchestrator/spacetime-client/types';
import { createSpacetimePresence, presenceTransportKind, spacetimePresencePeers, viewerColor, type PresencePeer } from './presence';
import { FLOOR } from './play';

const row: OfficePresence = { viewerId: 'viewer-other', name: 'Other', x: 2, z: 3, yaw: 1, mode: 'play', at: 1000n };
const self: PresencePeer = { viewerId: 'viewer-self', name: 'Self', color: '#ffffff', x: 1, z: 2, yaw: 0, mode: 'play', at: 999999 };
function fakeConnection() {
  const rows: OfficePresence[] = [];
  const events = { insert: new Set<() => void>(), update: new Set<() => void>(), delete: new Set<() => void>() };
  const table = { iter: () => rows.values(),
    onInsert: (cb: () => void) => events.insert.add(cb), removeOnInsert: (cb: () => void) => events.insert.delete(cb),
    onUpdate: (cb: () => void) => events.update.add(cb), removeOnUpdate: (cb: () => void) => events.update.delete(cb),
    onDelete: (cb: () => void) => events.delete.add(cb), removeOnDelete: (cb: () => void) => events.delete.delete(cb) };
  let applied = () => {}, failed = () => {};
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(() => ({ unsubscribe }));
  const subscription = { onApplied(cb: () => void) { applied = cb; return this; }, onError(cb: () => void) { failed = cb; return this; }, subscribe };
  const reducers = { officePresenceUpsert: vi.fn().mockResolvedValue(undefined), officePresenceLeave: vi.fn().mockResolvedValue(undefined) };
  const disconnect = vi.fn();
  const connection = { db: { officePresence: table }, reducers, isActive: true, disconnect, subscriptionBuilder: vi.fn(() => subscription) } as unknown as DbConnection;
  return { connection, rows, events, reducers, subscribe, unsubscribe, disconnect, apply: () => applied(), fail: () => failed() };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('SpacetimeDB viewer presence', () => {
  it('maps public rows to bounded peers with local colors and server milliseconds, excluding self', () => {
    const peers = spacetimePresencePeers([row, { ...row, viewerId: self.viewerId }, { ...row, viewerId: 'expired', at: 1n },
      { ...row, viewerId: 'invalid', mode: 'admin' }, { ...row, viewerId: 'overflow', at: 2n ** 64n }], self.viewerId, 11000);
    expect(peers).toEqual([{ ...row, at: 1000, color: viewerColor(row.viewerId) }]);
    expect(spacetimePresencePeers([{ ...row, x: 999, z: -999, name: 'Other\nname' }], self.viewerId, 1000)[0])
      .toMatchObject({ x: FLOOR.maxX, z: FLOOR.minZ, name: 'Othername' });
  });
  it('selects SpacetimeDB only for live mode with presence table and reducers; all other modes fall back', () => {
    const { connection } = fakeConnection();
    expect(presenceTransportKind('live', connection)).toBe('spacetime');
    for (const mode of ['preview', 'connecting', 'disconnected', 'replay'] as const) expect(presenceTransportKind(mode, connection)).toBe('broadcast');
    expect(presenceTransportKind('live')).toBe('broadcast');
    expect(presenceTransportKind('live', { ...connection, db: {} } as DbConnection)).toBe('broadcast');
    expect(presenceTransportKind('live', { ...connection, reducers: {} } as DbConnection)).toBe('broadcast');
  });
  it('reuses the office connection, waits for subscription application, and observes inserts, updates and deletes', () => {
    const builder = vi.spyOn(DbConnection, 'builder');
    const fake = fakeConnection();
    const transport = createSpacetimePresence(fake.connection, self.viewerId, () => 1000);
    const received = vi.fn();
    const unsubscribe = transport.subscribe(received);
    transport.publish(self);
    expect(received).toHaveBeenLastCalledWith([]);
    expect(fake.reducers.officePresenceUpsert).not.toHaveBeenCalled();
    expect(fake.subscribe).toHaveBeenCalledWith('SELECT * FROM office_presence');
    fake.rows.push(row); fake.apply();
    expect(received.mock.lastCall?.[0]?.[0]).toMatchObject({ viewerId: row.viewerId, at: 1000 });
    fake.rows.push({ ...row, viewerId: self.viewerId }); fake.events.insert.forEach(cb => cb());
    expect(received.mock.lastCall?.[0]).toHaveLength(1);
    fake.rows[0] = { ...row, x: 3 }; fake.events.update.forEach(cb => cb());
    expect(received.mock.lastCall?.[0]?.[0]?.x).toBe(3);
    fake.rows.splice(0); fake.events.delete.forEach(cb => cb());
    expect(received).toHaveBeenLastCalledWith([]);
    fake.fail();
    expect(received).toHaveBeenLastCalledWith([]);
    unsubscribe(); transport.close();
    expect(fake.unsubscribe).toHaveBeenCalledOnce();
    expect([...Object.values(fake.events)].every(set => set.size === 0)).toBe(true);
    expect(builder).not.toHaveBeenCalled();
    expect(fake.disconnect).not.toHaveBeenCalled();
  });
  it('publishes at most every 250ms without client time/color, leaves once on close, and never writes after close', () => {
    const fake = fakeConnection();
    let now = 0;
    const transport = createSpacetimePresence(fake.connection, self.viewerId, () => now);
    fake.apply();
    transport.publish(self);
    now = 249; transport.publish({ ...self, x: 3 });
    expect(fake.reducers.officePresenceUpsert).toHaveBeenCalledOnce();
    now = 250; transport.publish({ ...self, x: 3 });
    expect(fake.reducers.officePresenceUpsert).toHaveBeenCalledTimes(2);
    expect(fake.reducers.officePresenceUpsert).toHaveBeenLastCalledWith({ viewerId: self.viewerId, name: 'Self', x: 3, z: 2, yaw: 0, mode: 'play' });
    transport.close(); transport.close();
    now = 1000; transport.publish(self);
    expect(fake.reducers.officePresenceLeave).toHaveBeenCalledExactlyOnceWith({ viewerId: self.viewerId });
    expect(fake.reducers.officePresenceUpsert).toHaveBeenCalledTimes(2);
  });
  it('leaves on pagehide, resumes a restored page, and handles failed writes without affecting the office', async () => {
    const page = new EventTarget(); vi.stubGlobal('window', page);
    const fake = fakeConnection();
    fake.reducers.officePresenceUpsert.mockRejectedValue(new Error('full'));
    fake.reducers.officePresenceLeave.mockRejectedValue(new Error('disconnected'));
    const transport = createSpacetimePresence(fake.connection, self.viewerId, () => 1000);
    fake.apply(); transport.publish(self);
    page.dispatchEvent(new Event('pagehide'));
    transport.publish(self);
    expect(fake.reducers.officePresenceUpsert).toHaveBeenCalledOnce();
    expect(fake.reducers.officePresenceLeave).toHaveBeenCalledOnce();
    page.dispatchEvent(new Event('pageshow')); transport.publish(self);
    expect(fake.reducers.officePresenceUpsert).toHaveBeenCalledTimes(2);
    transport.close();
    page.dispatchEvent(new Event('pagehide'));
    expect(fake.reducers.officePresenceLeave).toHaveBeenCalledTimes(2);
    await Promise.resolve();
  });
});
