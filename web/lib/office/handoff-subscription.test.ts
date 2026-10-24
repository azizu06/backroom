import { afterEach, expect, it, vi } from 'vitest';
import { DbConnection } from '@backroom/orchestrator/spacetime-client';
import { createSpacetimeOfficeState, OFFICE_QUERIES } from './spacetime';
import { handoffGroups, upsertHandoffs, type Handoff } from './handoffs';
import type { AgentHandoffPublic } from '@backroom/orchestrator/spacetime-client/types';
import { projectOfficeRows } from './spacetime';

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

it('projects four agent_handoff_public rows of a five-role chain in sequence order without legacy seat agents', () => {
  const chain: Handoff[] = [
    { ...offered, handoffId: 'h4', sequence: 4n, fromRole: 'payables', toRole: 'reconciler', createdAt: 4000 },
    { ...offered, handoffId: 'h2', sequence: 2n, fromRole: 'extractor', toRole: 'vendor', createdAt: 2000 },
    { ...offered, handoffId: 'h3', sequence: 3n, fromRole: 'vendor', toRole: 'payables', createdAt: 3000 },
    { ...offered, handoffId: 'h1', sequence: 1n, fromRole: 'intake', toRole: 'extractor', createdAt: 1000 },
  ];
  const snapshot = projectOfficeRows({ agents: [], rooms: [], seats: [], badges: [], escalations: [], audit: [], control: [],
    handoffs: chain as unknown as AgentHandoffPublic[] });
  expect(snapshot.connection).toBe('live');
  expect(snapshot.agents).toEqual([]);
  expect(snapshot.handoffs?.map(row => row.handoffId)).toEqual(['h1', 'h2', 'h3', 'h4']);
  expect(handoffGroups(snapshot.handoffs!).flatMap(group => group.rows).map(row => row.handoffId)).toEqual(['h1', 'h2', 'h3', 'h4']);
  expect(snapshot.handoffs?.map(row => [row.fromRole, row.toRole])).toEqual([
    ['intake', 'extractor'], ['extractor', 'vendor'], ['vendor', 'payables'], ['payables', 'reconciler'],
  ]);
});
