/**
 * Agent-to-agent handoffs drawn in the office. Visual only: a handoff row never triggers a reducer,
 * policy evaluation or payment. The backend (single-responsibility agents) writes one row per handoff;
 * `handoffFromRow` is the one place that maps that row into the shape the planner draws.
 */
import type { AnchorId, FloorPosition } from './state';

export type HandoffStatus = 'pending' | 'accepted' | 'failed' | 'awaiting_passkey';
export interface Handoff {
  readonly id: string;
  /** Agent role id (see HANDOFF_AGENTS); `human` is Dana at the passkey step. */
  readonly from: string;
  readonly to: string;
  /** What is being handed over, e.g. an invoice id. */
  readonly item: string;
  /** One-line summary shown in the speech bubble. */
  readonly summary: string;
  readonly status: HandoffStatus;
  /** Epoch ms the row was written. */
  readonly at: number;
  /** Epoch ms of the latest status change, when the row was updated after insert. */
  readonly updatedAt?: number;
}

export type HandoffAgentId = 'intake' | 'extractor' | 'vendor_verifier' | 'payables' | 'collections' | 'reconciler' | 'auditor' | 'human';
export interface HandoffAgent {
  readonly name: string;
  readonly room: AnchorId;
  /** Where the agent stands when idle. Kept clear of officeColliders (see handoffs.test.ts). */
  readonly station: FloorPosition;
  readonly color: string;
}
export const HUMAN = 'human' satisfies HandoffAgentId;
/** Provisional desks for the backend's agents; the office has five rooms, so some rooms seat two. */
export const HANDOFF_AGENTS: Record<HandoffAgentId, HandoffAgent> = {
  intake: { name: 'Intake', room: 'lobby', station: [-6.0, 2.5], color: '#8fa7b8' },
  extractor: { name: 'Extractor', room: 'lobby', station: [-7.0, 1.7], color: '#9fb6a0' },
  auditor: { name: 'Auditor', room: 'lobby', station: [-3.4, 2.4], color: '#b8a2c8' },
  collections: { name: 'Collections', room: 'collections', station: [-4.4, -1.6], color: '#a9bc8f' },
  reconciler: { name: 'Reconciler', room: 'payables', station: [-0.6, -1.6], color: '#8fb3ad' },
  payables: { name: 'Payables', room: 'payables', station: [0.6, -1.6], color: '#d2b27a' },
  vendor_verifier: { name: 'Vendor verifier', room: 'vendor_onboarding', station: [4.4, -1.6], color: '#b2a3bb' },
  human: { name: 'Dana', room: 'dana', station: [0, 2.3], color: '#cc9c7d' },
};
export function isHandoffAgent(id: unknown): id is HandoffAgentId {
  return typeof id === 'string' && Object.hasOwn(HANDOFF_AGENTS, id);
}
export function handoffAgentName(id: string): string {
  return isHandoffAgent(id) ? HANDOFF_AGENTS[id].name : id;
}
/** Agents drawn on the floor (Dana only appears at the passkey step). */
export const FLOOR_AGENTS = (Object.keys(HANDOFF_AGENTS) as HandoffAgentId[]).filter(id => id !== HUMAN);

/** Where agents leave a room for the central aisle (z = AISLE_Z), clear of door posts and desks. */
export const ROOM_DOORS: Partial<Record<AnchorId, FloorPosition>> = {
  lobby: [-5.3, 1.5], collections: [-5, -1.3], payables: [0, -1.3], vendor_onboarding: [5, -1.3], dana: [0, 1.6],
};
export const AISLE_Z = 0.6;
/** Where a visitor stands to hand a folder to `agent`: in front of its station, toward its room door. */
export function handoffSpot(agent: HandoffAgentId): FloorPosition {
  const { station, room } = HANDOFF_AGENTS[agent];
  const door = ROOM_DOORS[room] ?? station;
  const dx = door[0] - station[0], dz = door[1] - station[1];
  const length = Math.hypot(dx, dz) || 1;
  const reach = Math.min(0.6, length);
  return [station[0] + dx / length * reach, station[1] + dz / length * reach];
}
function same(a: FloorPosition, b: FloorPosition) { return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6; }
/** Walk path from `from`'s station to the spot in front of `to`: out its door, along the aisle, in the other door. */
export function handoffRoute(from: HandoffAgentId, to: HandoffAgentId): FloorPosition[] {
  const a = HANDOFF_AGENTS[from], b = HANDOFF_AGENTS[to];
  const spot = handoffSpot(to);
  const points: FloorPosition[] = a.room === b.room ? [a.station, spot] : (() => {
    const out = ROOM_DOORS[a.room] ?? a.station, inn = ROOM_DOORS[b.room] ?? b.station;
    return [a.station, out, [out[0], AISLE_Z], [inn[0], AISLE_Z], inn, spot];
  })();
  return points.filter((point, i) => i === 0 || !same(point, points[i - 1]!));
}
export function routeLength(route: readonly FloorPosition[]): number {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += Math.hypot(route[i]![0] - route[i - 1]![0], route[i]![1] - route[i - 1]![1]);
  return total;
}

const STATUSES: Record<string, HandoffStatus> = {
  pending: 'pending', sent: 'pending', in_progress: 'pending', open: 'pending',
  accepted: 'accepted', done: 'accepted', ok: 'accepted', passed: 'accepted', complete: 'accepted', completed: 'accepted',
  failed: 'failed', rejected: 'failed', returned: 'failed', error: 'failed',
  awaiting_passkey: 'awaiting_passkey', needs_passkey: 'awaiting_passkey', passkey: 'awaiting_passkey', awaiting_approval: 'awaiting_passkey',
};
const AGENT_ALIASES: Record<string, HandoffAgentId> = {
  vendor: 'vendor_verifier', vendor_verification: 'vendor_verifier', verifier: 'vendor_verifier',
  dana: 'human', controller: 'human', approver: 'human', reconciliation: 'reconciler', audit: 'auditor',
};
export function normalizeAgent(value: unknown): string {
  const id = String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return AGENT_ALIASES[id] ?? id;
}
export function normalizeStatus(value: unknown): HandoffStatus {
  return STATUSES[String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? 'pending';
}
function epochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e14 ? Math.floor(value / 1000) : value; // micros → ms
  if (typeof value === 'bigint') return Number(value > 100_000_000_000_000n ? value / 1000n : value);
  if (value && typeof value === 'object' && 'microsSinceUnixEpoch' in value) return epochMs((value as { microsSinceUnixEpoch: unknown }).microsSinceUnixEpoch);
  if (value && typeof value === 'object' && '__timestamp_micros_since_unix_epoch__' in value) {
    return epochMs((value as { __timestamp_micros_since_unix_epoch__: unknown }).__timestamp_micros_since_unix_epoch__);
  }
  if (typeof value === 'string' && value) { const parsed = Date.parse(value); return Number.isNaN(parsed) ? undefined : parsed; }
  return undefined;
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ BACKEND CONTRACT MAPPING — the one place to wire Aziz's real handoff table.              │
 * │ Provisional: the heads-up (board comment 6385111138) promised a SpacetimeDB row with     │
 * │ from, to, item, one-line summary and status. When the table/reducer contract is posted,  │
 * │ replace the field picks below with its exact column names and add the subscription in    │
 * │ spacetime.ts (`snapshot.handoffs = rows.map(handoffFromRow).filter(Boolean)`).           │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 * Returns null for rows that cannot be drawn (missing id or endpoints). Unknown agent ids are kept
 * (they appear in the text log) but the planner does not animate them.
 */
export function handoffFromRow(row: Readonly<Record<string, unknown>>, received = Date.now()): Handoff | null {
  const id = row.id ?? row.handoffId ?? row.handoff_id;
  const from = normalizeAgent(row.from ?? row.fromAgent ?? row.from_agent);
  const to = normalizeAgent(row.to ?? row.toAgent ?? row.to_agent);
  if (id === undefined || id === null || !from || !to) return null;
  const at = epochMs(row.at ?? row.createdAt ?? row.created_at) ?? received;
  const updatedAt = epochMs(row.updatedAt ?? row.updated_at);
  return {
    id: String(id), from, to,
    item: String(row.item ?? row.itemId ?? row.item_id ?? ''),
    summary: String(row.summary ?? ''),
    status: normalizeStatus(row.status),
    at, ...(updatedAt !== undefined && updatedAt !== at ? { updatedAt } : {}),
  };
}

export function statusLabel(status: HandoffStatus): string {
  return status === 'awaiting_passkey' ? 'awaiting passkey' : status;
}
/** One line for the aria-live log and the reduced-motion view. */
export function handoffLine(handoff: Handoff): string {
  const item = handoff.item ? ` · ${handoff.item}` : '';
  const outcome = handoff.status === 'failed' ? ' · check failed, returned' : handoff.status === 'awaiting_passkey' ? ' · waiting for Dana’s passkey' : ` · ${statusLabel(handoff.status)}`;
  return `${handoffAgentName(handoff.from)} → ${handoffAgentName(handoff.to)}${item}: ${handoff.summary}${outcome}`;
}

/** Office search flag: `?handoffs=mock` plays the fixture stream; `handoffSpeed` (1–8) speeds it up. */
export function handoffFlag(search: string): { mock: boolean; speed: number } {
  const params = new URLSearchParams(search);
  const speed = Number(params.get('handoffSpeed') ?? 1);
  return { mock: params.get('handoffs') === 'mock', speed: Number.isFinite(speed) ? Math.min(8, Math.max(1, speed)) : 1 };
}
