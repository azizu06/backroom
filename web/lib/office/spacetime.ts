import { DbConnection } from '@backroom/orchestrator/spacetime-client';
import type { Agent, AuditEntry, Badge, Escalation, Room, Seat, RuntimeControl } from '@backroom/orchestrator/spacetime-client/types';
import { INITIAL_OFFICE, OFFICE_ANCHORS, type AnchorId, type OfficeSnapshot, type OfficeAudit, type SeatId } from './state';

export interface OfficeConnectionConfig { uri: string; database: string }
export const OFFICE_QUERIES = ['agent', 'room', 'seat', 'badge', 'escalation', 'audit_entry', 'runtime_control']
  .map(table => `SELECT * FROM ${table}`);
export interface OfficeRows {
  agents: Agent[]; rooms: Room[]; seats: Seat[]; badges: Badge[];
  escalations: Escalation[]; audit: AuditEntry[]; control: RuntimeControl[];
}
function anchor(value: string): AnchorId | undefined {
  const id = value.toLowerCase().replace(/[-_]desk$/, '');
  return Object.hasOwn(OFFICE_ANCHORS, id) ? id as AnchorId : undefined;
}
const isSeat = (id: string): id is SeatId => ['collections', 'payables', 'vendor_onboarding'].includes(id);
const object = (value: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_OFFICE_ROW');
  return parsed as Record<string, unknown>;
};
/** Projection only: no permission inference, model call, reducer, or business effect. */
export function projectOfficeRows(rows: OfficeRows): OfficeSnapshot {
  const rooms = rows.rooms.flatMap(row => {
    const id = anchor(row.id);
    return id ? [{ id, rowId: row.id }] : [];
  });
  const hasRoom = (id: AnchorId) => rooms.some(row => row.id === id);
  const badges = rows.badges.flatMap(row => isSeat(row.seatId) && rows.seats.some(seat =>
    seat.seatId === row.seatId && seat.policyVersion === row.policyVersion)
    ? [{ seatId: row.seatId, policyVersion: row.policyVersion, actions: row.allowedActions,
      rooms: row.allowedRooms, limits: object(row.limits) }] : []);
  const audit = [...rows.audit].sort((a, b) => a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0).map(row => {
    const inputs = object(row.inputs);
    return { id: row.id, agentId: typeof inputs.agentId === 'string' ? inputs.agentId : '', seatId: row.seat,
      action: row.action, decision: row.decision === 'ALLOW' || row.decision === 'DENY' || row.decision === 'ESCALATE'
        ? row.decision : 'RECORDED' as const,
      ruleIds: row.ruleIds, room: typeof inputs.room === 'string' ? anchor(inputs.room) : undefined,
      summary: `${row.action.replaceAll('_', ' ')} · ${row.refs.join(', ')}`, at: row.ts, refs: row.refs } satisfies OfficeAudit & { at: number; refs: string[] };
  });
  const denials = audit.flatMap(row => row.action === 'request_room_entry' && row.decision === 'DENY' && row.room && row.agentId
    ? [{ room: row.room, agentId: row.agentId, auditId: row.id, at: row.at }] : []);
  const agents = rows.agents.flatMap(row => {
    const targetAnchor = anchor(row.targetAnchor || row.room);
    if (!isSeat(row.seatId) || !badges.some(badge => badge.seatId === row.seatId) || !targetAnchor || !hasRoom(targetAnchor)) return [];
    const escalation = rows.escalations.find(e => e.fromAgent === row.id && e.status === 'pending');
    return [{ id: row.id, name: row.id, seatId: row.seatId, state: row.state, targetAnchor,
      pos: [row.posX, row.posZ] as const, rowAt: Number(row.heartbeatAt.microsSinceUnixEpoch / 1000n),
      escalationId: targetAnchor === 'dana' ? escalation?.id : undefined }];
  });
  const inboxReceipts = audit.filter(row => ['submit_inbox_item', 'judge_inbox_decision', 'route_inbox_item'].includes(row.action));
  return { agents, rooms, badges, audit, denials, inboxReceipts, inboxCount: inboxReceipts.length,
    connection: 'live', llmEnabled: rows.control.find(row => row.id === 'global')?.llmEnabled ?? null };
}

/** One anonymous subscription owns every lobby/office projection. Tokens never enter this API. */
export function createSpacetimeOfficeState(config: OfficeConnectionConfig) {
  let snapshot = INITIAL_OFFICE;
  let connection: DbConnection | undefined;
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: OfficeSnapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
  const disconnect = () => {
    generation++;
    connection?.disconnect(); connection = undefined;
    publish({ ...snapshot, connection: 'disconnected', llmEnabled: null });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    disconnect,
    connect() {
      if (connection) return;
      const current = ++generation;
      let applied = false, queued = false, hooked = false;
      publish({ ...snapshot, connection: 'connecting', llmEnabled: null });
      const failed = () => {
        if (generation !== current) return;
        applied = false;
        publish({ ...snapshot, connection: 'disconnected', llmEnabled: null });
      };
      const refresh = (db: DbConnection) => {
        if (!applied || generation !== current) return;
        try {
          publish(projectOfficeRows({ agents: [...db.db.agent.iter()], rooms: [...db.db.room.iter()],
            seats: [...db.db.seat.iter()], badges: [...db.db.badge.iter()], escalations: [...db.db.escalation.iter()],
            audit: [...db.db.auditEntry.iter()], control: [...db.db.runtimeControl.iter()] }));
        } catch { failed(); }
      };
      try {
        connection = DbConnection.builder().withUri(config.uri).withDatabaseName(config.database).withAutomaticReconnect()
          .onConnect(db => {
            if (generation !== current) return;
            applied = false;
            const changed = () => {
              if (queued) return;
              queued = true;
              queueMicrotask(() => { queued = false; refresh(db); });
            };
            if (!hooked) {
              for (const table of [db.db.agent, db.db.room, db.db.seat, db.db.badge, db.db.escalation, db.db.auditEntry, db.db.runtimeControl]) {
                table.onInsert(changed); table.onUpdate(changed); table.onDelete(changed);
              }
              hooked = true;
            }
            db.subscriptionBuilder().onApplied(() => { applied = true; refresh(db); })
              .onError(failed).subscribe(OFFICE_QUERIES);
          }).onConnectError(failed).onDisconnect(failed).build();
      } catch { failed(); }
    },
  };
}
