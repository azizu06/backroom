/**
 * Agent-to-agent handoffs drawn in the office. Visual only: a handoff row never triggers a reducer,
 * policy evaluation or payment. The backend (single-responsibility agents) writes one row per handoff;
 * `handoffFromRow` is the one place that maps that row into the shape the planner draws.
 */
import type { AnchorId, FloorPosition } from './state';
import { handoffText } from './handoff-text';

// Mirrors orchestrator/src/agents/contracts.ts ROLES and the public projection in docs/agents.md / PR #152.
export const HANDOFF_ROLES = ['intake', 'extractor', 'vendor', 'payables', 'collections', 'reconciler', 'auditor'] as const;
export type HandoffRole = typeof HANDOFF_ROLES[number];
export type HandoffStatus = 'offered' | 'accepted' | 'completed' | 'rejected';
export interface OfficeHandoffRow {
  readonly handoffId: string; readonly sequence: bigint | number; readonly caseDisplayId: string;
  readonly fromAgentId: string; readonly toAgentId: string; readonly fromRole: HandoffRole; readonly toRole: HandoffRole;
  readonly fromVoiceRole: string; readonly toVoiceRole: string; readonly status: HandoffStatus; readonly correction: boolean;
  readonly reason: string; readonly summary: string; readonly line: string; readonly createdAt: number;
  readonly acceptedAt?: number; readonly completedAt?: number; readonly decisionRef?: string; readonly errorCode?: string;
}
export type Handoff = OfficeHandoffRow;
export type HandoffAgentId = HandoffRole | 'human';
export interface HandoffAgent {
  readonly name: string;
  readonly room: AnchorId;
  /** Where the agent stands when idle. Kept clear of officeColliders (see handoffs.test.ts). */
  readonly station: FloorPosition;
  readonly color: string;
}
export const HUMAN = 'human' satisfies HandoffAgentId;
/** Desks for the runtime roles; the office has five rooms, so some rooms seat two. */
export const HANDOFF_AGENTS: Record<HandoffAgentId, HandoffAgent> = {
  intake: { name: 'Intake', room: 'lobby', station: [-6.0, 2.5], color: '#8fa7b8' },
  extractor: { name: 'Extractor', room: 'lobby', station: [-7.0, 1.7], color: '#9fb6a0' },
  auditor: { name: 'Auditor', room: 'lobby', station: [-3.4, 2.4], color: '#b8a2c8' },
  collections: { name: 'Collections', room: 'collections', station: [-4.4, -1.6], color: '#a9bc8f' },
  reconciler: { name: 'Reconciler', room: 'payables', station: [-0.6, -1.6], color: '#8fb3ad' },
  payables: { name: 'Payables', room: 'payables', station: [0.6, -1.6], color: '#d2b27a' },
  vendor: { name: 'Vendor verifier', room: 'vendor_onboarding', station: [4.4, -1.6], color: '#b2a3bb' },
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

function epochMs(value: unknown): number | undefined {
  const n = typeof value === 'bigint' ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}
const pick = (r: Readonly<Record<string, unknown>>, camel: string, snake: string) => r[camel] ?? r[snake];
const short = (v: unknown, max: number) => typeof v === 'string' ? v.slice(0, max) : '';
/** Count code points, extending the display limit only to finish a redaction token. */
function shortSummary(value: unknown): string {
  if (typeof value !== 'string') return '';
  let result = '', remaining = 160;
  for (const part of handoffText(value)) {
    if (remaining <= 0) break;
    const points = Array.from(part.text);
    result += part.masked ? part.text : points.slice(0, remaining).join('');
    remaining -= points.length;
  }
  return result;
}
/** Public projection adapter; missing timestamps leave a static historical row rather than replaying it. */
export function handoffFromRow(raw: unknown): Handoff | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Readonly<Record<string, unknown>>;
  const fromRole = pick(row, 'fromRole', 'from_role'), toRole = pick(row, 'toRole', 'to_role');
  // Primary keys must stay lossless: runtime IDs include an uncapped case ID before :aN:hN.
  const status = row.status, handoffId = pick(row, 'handoffId', 'handoff_id');
  if (typeof handoffId !== 'string' || !handoffId || !(HANDOFF_ROLES as readonly unknown[]).includes(fromRole) || !(HANDOFF_ROLES as readonly unknown[]).includes(toRole)
    || typeof status !== 'string' || !['offered', 'accepted', 'completed', 'rejected'].includes(status)) return null;
  const sequence = row.sequence;
  if (!(typeof sequence === 'bigint' ? sequence >= 0n && sequence <= 18_446_744_073_709_551_615n
    : typeof sequence === 'number' && Number.isSafeInteger(sequence) && sequence >= 0)) return null;
  const acceptedAt = epochMs(pick(row, 'acceptedAt', 'accepted_at')), completedAt = epochMs(pick(row, 'completedAt', 'completed_at'));
  const decisionRef = short(pick(row, 'decisionRef', 'decision_ref'), 256), errorCode = short(pick(row, 'errorCode', 'error_code'), 128);
  return {
    handoffId, sequence: sequence as bigint | number, caseDisplayId: short(pick(row, 'caseDisplayId', 'case_display_id'), 128),
    fromAgentId: short(pick(row, 'fromAgentId', 'from_agent_id'), 128), toAgentId: short(pick(row, 'toAgentId', 'to_agent_id'), 128),
    fromRole: fromRole as HandoffRole, toRole: toRole as HandoffRole,
    fromVoiceRole: short(pick(row, 'fromVoiceRole', 'from_voice_role'), 64), toVoiceRole: short(pick(row, 'toVoiceRole', 'to_voice_role'), 64),
    status: status as HandoffStatus, correction: row.correction === true,
    reason: short(row.reason, 1000), summary: shortSummary(row.summary), line: typeof row.line === 'string' ? row.line : '',
    createdAt: epochMs(pick(row, 'createdAt', 'created_at')) ?? 0,
    ...(acceptedAt !== undefined ? { acceptedAt } : {}), ...(completedAt !== undefined ? { completedAt } : {}),
    ...(decisionRef ? { decisionRef } : {}), ...(errorCode ? { errorCode } : {}),
  };
}
/** Relational comparison preserves u64 order even above Number.MAX_SAFE_INTEGER. */
export function compareHandoffs(a: Handoff, b: Handoff): number {
  return a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : a.handoffId.localeCompare(b.handoffId);
}
/** Never infer human involvement from a status, role, summary or spoken line. */
export function needsHandoffHuman(row: Handoff): boolean {
  return [row.reason, row.decisionRef ?? ''].some(text => /\b(?:passkey|human approval|escalat)/i.test(text)
    && !/\b(?:no|not|without)[\s_-]+(?:(?:an?|any)\s+)?(?:passkey|human approval|escalat)/i.test(text));
}
export function handoffLine(h: Handoff): string {
  return `${h.correction ? 'Correction · ' : ''}${handoffAgentName(h.fromRole)} → ${handoffAgentName(h.toRole)} · ${h.caseDisplayId}: ${h.reason} · ${h.summary} · ${handoffStatus(h)}${h.status === 'rejected' && h.errorCode ? ` · ${h.errorCode}` : ''}`;
}
export function statusLabel(status: HandoffStatus): string { return status === 'completed' ? 'done' : status; }
export function handoffStatus(row: Handoff): string {
  return row.status === 'completed' ? `done · ${handoffAgentName(row.toRole)} finished its turn` : statusLabel(row.status);
}
/** Subscription snapshots/events replace by primary key, even when sequence has not changed. */
export function upsertHandoffs(rows: readonly Handoff[], updates: readonly Handoff[]): Handoff[] {
  const keyed = new Map(rows.map(row => [row.handoffId, row]));
  for (const row of updates) keyed.set(row.handoffId, row);
  return [...keyed.values()].sort(compareHandoffs);
}
/** Sequence-ordered case groups for the accessible log. */
export function handoffGroups(rows: readonly Handoff[]): { caseDisplayId: string; rows: Handoff[] }[] {
  const groups = new Map<string, Handoff[]>();
  for (const row of [...rows].sort(compareHandoffs).slice(-8)) {
    const group = groups.get(row.caseDisplayId) ?? [];
    group.push(row); groups.set(row.caseDisplayId, group);
  }
  return [...groups].map(([caseDisplayId, rows]) => ({ caseDisplayId, rows }));
}

/** Office search flag: `?handoffs=mock` plays the fixture stream; `handoffSpeed` (1–8) speeds it up. */
export function handoffFlag(search: string): { mock: boolean; speed: number } {
  const params = new URLSearchParams(search);
  const speed = Number(params.get('handoffSpeed') ?? 1);
  return { mock: params.get('handoffs') === 'mock', speed: Number.isFinite(speed) ? Math.min(8, Math.max(1, speed)) : 1 };
}
