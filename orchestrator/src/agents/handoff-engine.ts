import { ROLES, type HandoffRecord, type HandoffRequest, type Role } from './contracts';
import type { HandoffRole } from '../voice/voices';

/** Pure, deterministic case/handoff state machine. MemoryHandoffStore and the
 * SpacetimeDB `agent_*` reducers both run it, so ownership rules exist once.
 * No I/O, no clock, no randomness: callers pass `now` and the next sequence. */

/** Spike graph. Auditor may return to any role that already worked this case. */
export const ALLOWED_GRAPH: Readonly<Record<Role, readonly Role[]>> = {
  intake: ['extractor'],
  extractor: ['vendor', 'payables', 'intake'],
  vendor: ['payables', 'extractor'],
  payables: ['auditor', 'extractor', 'vendor'],
  collections: ['reconciler'],
  reconciler: ['auditor', 'collections'],
  auditor: ['intake', 'extractor', 'vendor', 'payables', 'collections', 'reconciler'],
};
/** Backward edges: a request for missing evidence or a fix, bounded per case. */
const CORRECTIONS: Readonly<Partial<Record<Role, readonly Role[]>>> = {
  extractor: ['intake'], vendor: ['extractor'], payables: ['extractor', 'vendor'],
  reconciler: ['collections'], auditor: ROLES.filter(role => role !== 'auditor'),
};
/** Only these roles may finish a case without handing off. */
export const TERMINAL_ROLES: readonly Role[] = ['auditor'];
export const CASE_LIMITS = { maxActivations: 10, maxCorrections: 2 } as const;
export const ROLE_VOICE: Readonly<Record<Role, HandoffRole>> = {
  intake: 'intake_sorter', extractor: 'extractor', vendor: 'vendor_verifier', payables: 'payables',
  collections: 'collections_caller', reconciler: 'reconciler', auditor: 'auditor',
};
export const isCorrection = (from: Role, to: Role) => CORRECTIONS[from]?.includes(to) ?? false;
export const agentIdFor = (role: Role) => `${role}-agent`;

export type CaseStatus = 'open' | 'done' | 'held' | 'paused' | 'failed' | 'cancelled';
export type ActivationStatus = 'queued' | 'active' | 'handed_off' | 'done' | 'held' | 'paused' | 'failed' | 'cancelled';
export interface ActivationRow {
  activationId: string; role: Role; status: ActivationStatus; artifactRefs: string[];
  leaseOwner?: string; leaseToken?: number; inboundHandoffId?: string;
  createdAt: number; startedAt?: number; endedAt?: number; reason?: string;
}
export interface HandoffRow extends HandoffRecord {
  sequence: number; createdAt: number; acceptedAt?: number; completedAt?: number;
  toActivationId?: string; correction: boolean; errorCode?: string;
}
export interface CaseState {
  caseId: string; displayId: string; status: CaseStatus; reason?: string;
  /** Monotonic fencing token; every start and cancel bumps it. */
  leaseToken: number; activeActivationId?: string; queuedActivationId?: string;
  activations: ActivationRow[]; knownRefs: string[]; corrections: number;
  handoffs: HandoffRow[]; createdAt: number;
}
/** Allowlisted office row. Never carries packets, documents, contacts or bank data. */
export interface AgentHandoffPublic {
  handoffId: string; sequence: number; caseDisplayId: string;
  fromAgentId: string; toAgentId: string; fromRole: Role; toRole: Role;
  fromVoiceRole: HandoffRole; toVoiceRole: HandoffRole;
  status: HandoffRow['status']; correction: boolean; reason: string; summary: string;
  /** Cartesia-safe speech line for `toRole`'s voice, ≤240 chars, no control chars or angle brackets. */
  line: string; createdAt: number; acceptedAt?: number; completedAt?: number;
  decisionRef?: string; errorCode?: string;
}
export interface LeaseClaim { activationId: string; leaseOwner: string; leaseToken: number }
export type CommitResult = { ok: true; record: HandoffRow; replayed: boolean } | { ok: false; record: HandoffRow };

export class AgentStateError extends Error {}
const fail = (code: string): never => { throw new AgentStateError(code); };
const REF = /^[A-Za-z0-9][A-Za-z0-9:._/#-]{0,199}$/;

export function openCase(prior: CaseState | undefined, input: { caseId: string; role: Role; artifactRefs: string[]; displayId?: string; now: number }): CaseState {
  if (prior) return prior.activations[0]?.role === input.role ? prior : fail('AGENT_CASE_EXISTS');
  if (!REF.test(input.caseId) || !ROLES.includes(input.role)) fail('INVALID_AGENT_CASE');
  if (input.artifactRefs.length > 50 || !input.artifactRefs.every(ref => REF.test(ref))) fail('INVALID_ARTIFACT_REF');
  const activation: ActivationRow = { activationId: `${input.caseId}:a1`, role: input.role, status: 'queued',
    artifactRefs: [...input.artifactRefs], createdAt: input.now };
  return { caseId: input.caseId, displayId: safeText(input.displayId ?? input.caseId, 40), status: 'open', leaseToken: 0,
    queuedActivationId: activation.activationId, activations: [activation], knownRefs: [...new Set(input.artifactRefs)],
    corrections: 0, handoffs: [], createdAt: input.now };
}

export function startActivation(state: CaseState, input: { leaseOwner: string; now: number }) {
  if (state.status !== 'open') fail('AGENT_CASE_NOT_OPEN');
  if (state.activeActivationId) fail('AGENT_ACTIVATION_ACTIVE');
  const activation = state.activations.find(row => row.activationId === state.queuedActivationId) ?? fail('AGENT_NO_QUEUED_ACTIVATION');
  if (!input.leaseOwner || input.leaseOwner.length > 120) fail('INVALID_LEASE_OWNER');
  state.leaseToken += 1;
  Object.assign(activation, { status: 'active', leaseOwner: input.leaseOwner, leaseToken: state.leaseToken, startedAt: input.now });
  state.activeActivationId = activation.activationId; state.queuedActivationId = undefined;
  const inbound = state.handoffs.find(row => row.handoffId === activation.inboundHandoffId);
  if (inbound) Object.assign(inbound, { status: 'accepted', acceptedAt: input.now });
  return { activation: { ...activation }, inbound: inbound && { ...inbound } };
}

export function assertActive(state: CaseState, claim: LeaseClaim): ActivationRow {
  if (state.status !== 'open') fail('AGENT_CASE_NOT_OPEN');
  if (state.activeActivationId !== claim.activationId) fail('AGENT_ACTIVATION_NOT_ACTIVE');
  const row = state.activations.find(r => r.activationId === claim.activationId)!;
  if (row.leaseOwner !== claim.leaseOwner || row.leaseToken !== claim.leaseToken || state.leaseToken !== claim.leaseToken) fail('AGENT_LEASE_STALE');
  return row;
}

/** Refs come from code-owned tool outputs, never from model arguments. */
export function recordArtifacts(state: CaseState, claim: LeaseClaim, refs: string[]) {
  assertActive(state, claim);
  if (!refs.every(ref => REF.test(ref))) fail('INVALID_ARTIFACT_REF');
  const known = new Set(state.knownRefs);
  for (const ref of refs) known.add(ref);
  if (known.size > 500) fail('ARTIFACT_LIMIT');
  state.knownRefs = [...known];
}

const sameRequest = (a: HandoffRequest, b: HandoffRequest) =>
  a.to === b.to && a.reason === b.reason && a.summary === b.summary && a.artifactRefs.join('\n') === b.artifactRefs.join('\n');

/** Atomic: validate owner/token/edge/refs, dedupe on the source activation, close the
 * source and enqueue exactly one target. A validation failure leaves ownership with the
 * source and records a rejected row for the office's return trip. */
export function commitHandoff(state: CaseState, claim: LeaseClaim & { request: HandoffRequest; now: number; sequence: number }): CommitResult {
  const { request, now } = claim;
  const prior = state.handoffs.find(row => row.fromActivationId === claim.activationId && row.status !== 'rejected');
  if (prior) {
    if (prior.leaseToken !== claim.leaseToken || !sameRequest(prior, request)) fail('HANDOFF_CONFLICT');
    return { ok: true, record: { ...prior }, replayed: true };
  }
  const source = assertActive(state, claim);
  const rejected = (errorCode: string): CommitResult => {
    const record = row(state, source, request, claim, 'rejected', errorCode);
    state.handoffs.push(record);
    return { ok: false, record: { ...record } };
  };
  if (state.handoffs.some(r => r.fromActivationId === claim.activationId)) return rejected('HANDOFF_ALREADY_REJECTED');
  if (!ROLES.includes(request.to) || !ALLOWED_GRAPH[source.role].includes(request.to)) return rejected('HANDOFF_EDGE_NOT_ALLOWED');
  if (source.role === 'auditor' && !state.activations.some(a => a.role === request.to && a.status === 'handed_off'))
    return rejected('HANDOFF_TARGET_NOT_IN_CASE');
  if (typeof request.reason !== 'string' || !request.reason.trim() || request.reason.length > 280
    || typeof request.summary !== 'string' || !request.summary.trim() || request.summary.length > 500) return rejected('HANDOFF_INVALID_TEXT');
  if (!Array.isArray(request.artifactRefs) || !request.artifactRefs.length || request.artifactRefs.length > 20) return rejected('HANDOFF_EVIDENCE_REQUIRED');
  if (request.artifactRefs.some(ref => !state.knownRefs.includes(ref))) return rejected('HANDOFF_UNKNOWN_REF');
  const correction = isCorrection(source.role, request.to);
  if (correction && state.corrections >= CASE_LIMITS.maxCorrections) return rejected('HANDOFF_CORRECTION_LIMIT');
  if (state.activations.length >= CASE_LIMITS.maxActivations) return rejected('HANDOFF_ACTIVATION_LIMIT');

  const record = row(state, source, request, claim, 'offered');
  const target: ActivationRow = { activationId: `${state.caseId}:a${state.activations.length + 1}`, role: request.to,
    status: 'queued', artifactRefs: [...request.artifactRefs], inboundHandoffId: record.handoffId, createdAt: now };
  record.toActivationId = target.activationId;
  if (correction) state.corrections += 1;
  Object.assign(source, { status: 'handed_off', endedAt: now });
  completeInbound(state, source, now);
  state.activations.push(target);
  state.handoffs.push(record);
  state.activeActivationId = undefined; state.queuedActivationId = target.activationId;
  return { ok: true, record: { ...record }, replayed: false };
}

function row(state: CaseState, source: ActivationRow, request: HandoffRequest, claim: { leaseToken: number; now: number; sequence: number },
  status: HandoffRow['status'], errorCode?: string): HandoffRow {
  return { handoffId: `${source.activationId}:h${state.handoffs.filter(r => r.fromActivationId === source.activationId).length + 1}`,
    caseId: state.caseId, from: source.role, fromActivationId: source.activationId, leaseToken: claim.leaseToken, status,
    to: request.to, reason: String(request.reason ?? '').slice(0, 280), summary: String(request.summary ?? '').slice(0, 500),
    artifactRefs: Array.isArray(request.artifactRefs) ? request.artifactRefs.slice(0, 20).map(String) : [],
    sequence: claim.sequence, createdAt: claim.now, correction: ROLES.includes(request.to) && isCorrection(source.role, request.to),
    ...(errorCode ? { errorCode } : {}) };
}
function completeInbound(state: CaseState, activation: ActivationRow, now: number) {
  const inbound = state.handoffs.find(r => r.handoffId === activation.inboundHandoffId);
  if (inbound && inbound.status === 'accepted') Object.assign(inbound, { status: 'completed', completedAt: now });
}

export type FinishOutcome = 'done' | 'held' | 'paused' | 'failed';
export function finishActivation(state: CaseState, claim: LeaseClaim & { outcome: FinishOutcome; reason?: string; now: number }) {
  const activation = assertActive(state, claim);
  if (claim.outcome === 'done' && !TERMINAL_ROLES.includes(activation.role)) fail('AGENT_DONE_NOT_TERMINAL');
  const reason = claim.reason ? safeText(claim.reason, 80) : undefined;
  Object.assign(activation, { status: claim.outcome, endedAt: claim.now, reason });
  completeInbound(state, activation, claim.now);
  state.activeActivationId = undefined;
  if (claim.outcome === 'paused') {
    // Resume reruns the same role from its own validated refs.
    const again: ActivationRow = { activationId: `${state.caseId}:a${state.activations.length + 1}`, role: activation.role,
      status: 'queued', artifactRefs: activation.artifactRefs, createdAt: claim.now };
    state.activations.push(again); state.queuedActivationId = again.activationId;
  }
  state.status = claim.outcome === 'paused' ? 'paused' : claim.outcome; state.reason = reason;
}
/** Code-owned stops before a model starts (OFF, budget, missing role). Queued work is kept for paused. */
export function stopCase(state: CaseState, input: { status: 'paused' | 'held' | 'failed' | 'cancelled'; reason: string; now: number }) {
  if (!['open', 'paused'].includes(state.status)) fail('AGENT_CASE_NOT_OPEN');
  state.leaseToken += 1; // fence any in-flight tool
  const active = state.activations.find(r => r.activationId === state.activeActivationId);
  if (active) {
    if (input.status === 'paused') fail('AGENT_ACTIVATION_ACTIVE');
    Object.assign(active, { status: 'cancelled', endedAt: input.now, reason: safeText(input.reason, 80) });
    state.activeActivationId = undefined;
  }
  if (input.status !== 'paused') {
    const queued = state.activations.find(r => r.activationId === state.queuedActivationId);
    if (queued) Object.assign(queued, { status: 'cancelled', endedAt: input.now });
    state.queuedActivationId = undefined;
    for (const h of state.handoffs) if (h.status === 'offered' || h.status === 'accepted') h.status = 'rejected', h.errorCode ??= 'CASE_STOPPED';
  }
  state.status = input.status; state.reason = safeText(input.reason, 80);
}
export function resumeCase(state: CaseState) {
  if (state.status !== 'paused' || !state.queuedActivationId) fail('AGENT_CASE_NOT_PAUSED');
  state.status = 'open'; state.reason = undefined;
}

/** Escape-free display text: drop control chars/angle brackets, mask long digit runs and emails. */
export function safeText(value: string, max: number): string {
  const text = String(value).replace(/[\x00-\x1f\x7f<>]/g, ' ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\d[\d -]{5,}\d/g, run => `••${run.replace(/\D/g, '').slice(-4)}`)
    .replace(/\s+/g, ' ').trim();
  return Array.from(text).length > max ? `${Array.from(text).slice(0, max - 1).join('')}…` : text;
}
export function toPublicHandoff(state: Pick<CaseState, 'displayId'>, record: HandoffRow): AgentHandoffPublic {
  const summary = safeText(record.summary, 160);
  return { handoffId: record.handoffId, sequence: record.sequence, caseDisplayId: state.displayId,
    fromAgentId: agentIdFor(record.from), toAgentId: agentIdFor(record.to), fromRole: record.from, toRole: record.to,
    fromVoiceRole: ROLE_VOICE[record.from], toVoiceRole: ROLE_VOICE[record.to] ?? ROLE_VOICE[record.from],
    status: record.status, correction: record.correction, reason: safeText(record.reason, 120), summary,
    line: summary || 'Handing this case over.', createdAt: record.createdAt,
    ...(record.acceptedAt !== undefined ? { acceptedAt: record.acceptedAt } : {}),
    ...(record.completedAt !== undefined ? { completedAt: record.completedAt } : {}),
    ...(record.toActivationId ? { decisionRef: record.toActivationId } : {}),
    ...(record.errorCode ? { errorCode: record.errorCode } : {}) };
}
