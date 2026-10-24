import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'spacetimedb';
import { DbConnection } from '@backroom/orchestrator/spacetime-client';
import { createSpacetimeOfficeState, OFFICE_QUERIES, projectOfficeRows, type OfficeRows } from './spacetime';
import { matchingDenial, visibleRooms } from './state';
import { officeConfig } from './config';

function rows(): OfficeRows {
  return {
    agents: [{ id: 'sam', seatId: 'payables', state: 'waiting', room: 'payables', targetAnchor: 'Dana_desk',
      posX: 1, posY: 0, posZ: 2, modelRoute: 'code', heartbeatAt: new Timestamp(1000000n), currentTaskId: 'trap' }],
    rooms: ['payables', 'dana_desk', 'treasury'].map(id => ({ id, name: id, requiredBadge: id, anchors: '{}' })),
    seats: [{ seatId: 'payables', policyVersion: 1, json: '{}' }],
    badges: [{ seatId: 'payables', policyVersion: 1, allowedRooms: ['payables'], allowedActions: ['pay_invoice'], limits: '{"maxPaymentCents":200000}' }],
    escalations: [{ id: 'e1', fromAgent: 'sam', toHuman: 'Dana', taskId: 'trap', status: 'pending', createdAt: 1000, expiresAt: 2000, ruleIds: ['BANK_CHANGE_HOLD'], evidenceRefs: ['4471'], json: '{}' }],
    audit: [{ seq: 2n, id: 'a2', ts: 1000, actor: 'code', seat: 'payables', action: 'request_room_entry',
      inputs: '{"agentId":"sam","room":"treasury"}', decision: 'DENY', ruleIds: ['NOT_IN_BADGE'], refs: ['sam', 'treasury'],
      policyVersion: 1, route: 'code', latencyMs: 0, costUsd: 0, hash: 'h', prevHash: 'p' }],
    control: [{ id: 'global', llmEnabled: false, generation: 2n, heartbeatAt: new Timestamp(1000000n) }],
  };
}
afterEach(() => vi.restoreAllMocks());
describe('anonymous office projection', () => {
  it('ties targets, folders, exact badges, rooms and red doors to subscribed rows', () => {
    const data = rows();
    const snapshot = projectOfficeRows(data);
    expect(snapshot.agents[0]).toMatchObject({ targetAnchor: 'dana', escalationId: 'e1', pos: [1, 2], rowAt: 1000 });
    expect(snapshot.badges[0]?.limits).toEqual({ maxPaymentCents: 200000 });
    expect(visibleRooms(snapshot)).toEqual(['payables', 'dana', 'treasury']);
    expect(matchingDenial(snapshot, 'treasury')?.auditId).toBe('a2');
    expect(snapshot.llmEnabled).toBe(false);
    data.escalations = [];
    expect(projectOfficeRows(data).agents[0]?.escalationId).toBeUndefined();
    data.audit = [];
    expect(matchingDenial(projectOfficeRows(data), 'treasury')).toBeUndefined();
    data.seats = [];
    expect(projectOfficeRows(data)).toMatchObject({ agents: [], badges: [] });
  });
  it('does not invent a folder, target, badge or room for incomplete rows', () => {
    const data = rows();
    data.escalations[0]!.status = 'approved';
    expect(projectOfficeRows(data).agents[0]?.escalationId).toBeUndefined();
    data.agents[0]!.targetAnchor = 'unknown';
    expect(projectOfficeRows(data).agents).toEqual([]);
    data.agents[0]!.targetAnchor = 'payables_desk';
    data.badges[0]!.policyVersion = 2;
    expect(projectOfficeRows(data).badges).toEqual([]);
    data.rooms = [];
    expect(visibleRooms(projectOfficeRows(data))).toEqual([]);
  });
  it('shares ordered audit and intake receipts, including non-decision rows', () => {
    const data = rows();
    data.audit.push({ ...data.audit[0]!, seq: 1n, id: 'a1', action: 'submit_inbox_item', decision: undefined, refs: ['judge:1'], inputs: '{}' });
    const snapshot = projectOfficeRows(data);
    expect(snapshot.audit.map(row => row.id)).toEqual(['a1', 'a2']);
    expect(snapshot.inboxReceipts?.[0]).toBe(snapshot.audit[0]);
    expect(snapshot.inboxCount).toBe(1);
    expect(snapshot.audit[0]?.decision).toBe('RECORDED');
  });
  it('selects live mode from the backend and serializes only anonymous coordinates', () => {
    expect(officeConfig({})).toBeNull();
    expect(officeConfig({ STATE_STORE: 'spacetime', SPACETIMEDB_URI: 'ws://localhost:3115', SPACETIMEDB_DATABASE: 'demo', SPACETIMEDB_TOKEN: 'private' }))
      .toEqual({ uri: 'ws://localhost:3115', database: 'demo' });
    expect(() => officeConfig({ STATE_STORE: 'spacetime' })).toThrow('SPACETIME_CONFIG_REQUIRED');
  });
  it('batches row callbacks, retains stale rows on disconnect, and catches up on reconnect without reducers', async () => {
    const data = rows();
    let connected: (db: DbConnection) => void = () => {};
    let disconnected = () => {};
    const changed: (() => void)[] = [];
    const table = (key: keyof OfficeRows) => ({ iter: () => data[key].values(),
      onInsert: (cb: () => void) => changed.push(cb), onUpdate: (cb: () => void) => changed.push(cb), onDelete: (cb: () => void) => changed.push(cb) });
    let applied = () => {};
    const subscribe = vi.fn(() => applied());
    const subscription = { onApplied(cb: () => void) { applied = cb; return this; }, onError() { return this; }, subscribe };
    const db = { db: { agent: table('agents'), room: table('rooms'), seat: table('seats'), badge: table('badges'),
      escalation: table('escalations'), auditEntry: table('audit'), runtimeControl: table('control') },
      subscriptionBuilder: () => subscription, disconnect: vi.fn() } as unknown as DbConnection;
    const builder = { withUri() { return this; }, withDatabaseName() { return this; }, withAutomaticReconnect() { return this; },
      onConnect(cb: typeof connected) { connected = cb; return this; }, onConnectError() { return this; },
      onDisconnect(cb: () => void) { disconnected = cb; return this; }, build: () => db };
    vi.spyOn(DbConnection, 'builder').mockReturnValue(builder as unknown as ReturnType<typeof DbConnection.builder>);
    const source = createSpacetimeOfficeState({ uri: 'ws://test', database: 'test' });
    expect(source.getPresenceConnection()).toBeUndefined();
    const listener = vi.fn(); source.subscribe(listener);
    source.connect(); connected(db);
    expect(subscribe).toHaveBeenCalledWith(OFFICE_QUERIES);
    expect(source.getSnapshot().connection).toBe('live');
    expect(source.getPresenceConnection()).toBe(db);
    listener.mockClear();
    data.control[0]!.llmEnabled = true;
    changed.forEach(cb => cb()); await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(source.getSnapshot().llmEnabled).toBe(true);
    disconnected();
    expect(source.getPresenceConnection()).toBeUndefined();
    expect(source.getSnapshot()).toMatchObject({ connection: 'disconnected', llmEnabled: null });
    data.agents[0]!.targetAnchor = 'payables_desk';
    changed.forEach(cb => cb()); await Promise.resolve();
    expect(source.getSnapshot().agents[0]?.targetAnchor).toBe('dana');
    connected(db);
    expect(source.getPresenceConnection()).toBe(db);
    expect(source.getSnapshot().agents[0]?.targetAnchor).toBe('payables');
    source.disconnect();
    expect(source.getPresenceConnection()).toBeUndefined();
    connected(db); await Promise.resolve();
    expect(source.getSnapshot().connection).toBe('disconnected');
  });
});
