import { afterEach, expect, it, vi } from 'vitest';
import { DbConnection } from '@backroom/orchestrator/spacetime-client';
import { createSpacetimeOfficeState, OFFICE_QUERIES } from './spacetime';
import { upsertHandoffs, type Handoff } from './handoffs';

const offered: Handoff = { handoffId: 'raw-case:handoff:1', sequence: 1n, caseDisplayId: 'INV-1',
  fromAgentId: 'a', toAgentId: 'b', fromRole: 'intake', toRole: 'extractor', fromVoiceRole: 'intake_sorter', toVoiceRole: 'extractor',
  status: 'offered', correction: false, createdAt: 1000, reason: 'Check invoice', summary: 'Public summary', line: 'Check [email].' };

afterEach(() => vi.restoreAllMocks());
it('upserts by handoffId without dropping same-sequence updates or independent rows', () => {
  const second = { ...offered, handoffId: 'second', sequence: 2n };
  const accepted = { ...offered, status: 'accepted' as const };
  expect(upsertHandoffs([second, offered], [accepted])).toEqual([accepted, second]);
});

it('subscribes to public inserts, updates and deletes; sequence never acts as a cursor', async () => {
  let currentRows: Handoff[] = [{ ...offered, handoffId: 'initial', sequence: 9n }];
  const events = { insert: () => {}, update: () => {}, delete: () => {} };
  const handoffs = { iter: () => currentRows.values(),
    onInsert: (callback: () => void) => { events.insert = callback; },
    onUpdate: (callback: () => void) => { events.update = callback; },
    onDelete: (callback: () => void) => { events.delete = callback; } };
  const empty = { iter: () => [].values(), onInsert() {}, onUpdate() {}, onDelete() {} };
  let connect = (_db: DbConnection) => {}, applied = () => {};
  const subscribe = vi.fn(() => applied());
  const subscription = { onApplied(callback: () => void) { applied = callback; return this; }, onError() { return this; }, subscribe };
  const db = { db: { agent: empty, room: empty, seat: empty, badge: empty, escalation: empty, auditEntry: empty, runtimeControl: empty, agentHandoffPublic: handoffs },
    subscriptionBuilder: () => subscription, disconnect() {} } as unknown as DbConnection;
  const builder = { withUri() { return this; }, withDatabaseName() { return this; }, withAutomaticReconnect() { return this; },
    onConnect(callback: typeof connect) { connect = callback; return this; }, onConnectError() { return this; }, onDisconnect() { return this; }, build: () => db };
  vi.spyOn(DbConnection, 'builder').mockReturnValue(builder as unknown as ReturnType<typeof DbConnection.builder>);
  const source = createSpacetimeOfficeState({ uri: 'ws://test', database: 'test' });
  source.connect(); connect(db);
  expect(subscribe).toHaveBeenCalledWith(OFFICE_QUERIES);
  expect(source.getSnapshot().handoffs).toEqual(currentRows);

  // A late insert belongs before the initial row, even though its sequence is smaller.
  currentRows = [...currentRows, offered]; events.insert(); await Promise.resolve();
  expect(source.getSnapshot().handoffs?.map(row => row.handoffId)).toEqual([offered.handoffId, 'initial']);
  currentRows = [...source.getSnapshot().handoffs!];
  const listener = vi.fn(); source.subscribe(listener);
  for (const status of ['accepted', 'completed', 'rejected'] as const) {
    currentRows = [{ ...offered, status, ...(status === 'rejected' ? { errorCode: 'CASE_STOPPED' } : {}) }, currentRows[1]!];
    events.update(); events.update(); await Promise.resolve();
    expect(source.getSnapshot().handoffs).toEqual(currentRows);
  }
  expect(listener).toHaveBeenCalledTimes(3);
  // An edit to text on the same key/status/sequence is also a fresh projection.
  currentRows = [{ ...currentRows[0]!, summary: 'GB29 NWBK ••6819 / [email]' }, currentRows[1]!];
  events.update(); await Promise.resolve();
  expect(source.getSnapshot().handoffs?.[0]!.summary).toBe(currentRows[0]!.summary);
  currentRows = currentRows.slice(1); events.delete(); await Promise.resolve();
  expect(source.getSnapshot().handoffs).toEqual(currentRows);
  source.disconnect();
});
