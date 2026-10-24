import { createHash } from 'node:crypto';
import type { AuditEntry, AuditInput } from '../store';

export const AUDIT_GENESIS_HASH = '0'.repeat(64);

/** Canonical JSON: lexical UTF-16 object keys, ordered arrays, ECMAScript JSON
 * strings/numbers. Undefined object fields are omitted, as with JSON.stringify.
 * Reject lossy non-JSON values instead of silently hashing a different value.
 */
export function canonicalAuditJson(value: unknown): string {
  const parents = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item);
    if (typeof item !== 'object' || !item || parents.has(item)) throw new Error('INVALID_AUDIT_JSON');
    parents.add(item);
    try {
      if (Array.isArray(item)) return `[${Array.from(item, value => encode(value)).join(',')}]`;
      if (![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new Error('INVALID_AUDIT_JSON');
      const object = item as Record<string, unknown>;
      return `{${Object.keys(object).sort().filter(key => object[key] !== undefined)
        .map(key => `${JSON.stringify(key)}:${encode(object[key])}`).join(',')}}`;
    } finally { parents.delete(item); }
  };
  return encode(value);
}

export const hashAudit = (entry: Omit<AuditEntry, 'hash'>): string =>
  createHash('sha256').update(canonicalAuditJson(entry), 'utf8').digest('hex');

export type ChainFailure = 'SEQ_MISMATCH' | 'ID_MISMATCH' | 'PREV_HASH_MISMATCH' | 'HASH_MISMATCH' | 'INVALID_ENTRY';
export type ChainStatus = { length: number; headHash: string } & (
  | { valid: true; firstBrokenSeq: null }
  | { valid: false; firstBrokenSeq: number; reason: ChainFailure }
);

/** Verify a complete, ordered chain starting at genesis, never a filtered page. */
export function verifyChain(entries: readonly AuditEntry[]): ChainStatus {
  const summary = { length: entries.length, headHash: entries.at(-1)?.hash ?? AUDIT_GENESIS_HASH };
  let previous = AUDIT_GENESIS_HASH;
  const ids = new Set<string>();
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    const seq = index + 1;
    const fail = (reason: ChainFailure): ChainStatus => ({ ...summary, valid: false, firstBrokenSeq: seq, reason });
    if (!entry || entry.seq !== seq) return fail('SEQ_MISMATCH');
    if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) return fail('ID_MISMATCH');
    if (entry.prevHash !== previous) return fail('PREV_HASH_MISMATCH');
    const { hash, ...body } = entry;
    try {
      validateInput(body);
      if (hashAudit(body) !== hash) return fail('HASH_MISMATCH');
    } catch { return fail('INVALID_ENTRY'); }
    previous = hash;
    ids.add(entry.id);
  }
  return { ...summary, valid: true, firstBrokenSeq: null };
}

function validateInput(input: AuditInput): void {
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');
  if (!['code', 'local_model', 'claude', 'human', 'client', 'system'].includes(input.actor) ||
      !['payables', 'collections', 'vendor_onboarding', 'controller'].includes(input.seat) ||
      typeof input.action !== 'string' || !input.action || typeof input.route !== 'string' || !input.route ||
      !strings(input.ruleIds) || !strings(input.refs) ||
      !Number.isSafeInteger(input.ts) || input.ts < 0 ||
      !Number.isSafeInteger(input.policyVersion) || input.policyVersion < 0 ||
      !Number.isFinite(input.latencyMs) || input.latencyMs < 0 || !Number.isFinite(input.costUsd) || input.costUsd < 0 ||
      (input.id !== undefined && !/^[A-Za-z0-9_.:-]{1,200}$/.test(input.id)) ||
      (input.decision !== undefined && !['ALLOW', 'DENY', 'ESCALATE'].includes(input.decision)) ||
      (input.inputs !== undefined && (!input.inputs || typeof input.inputs !== 'object' || Array.isArray(input.inputs)))) {
    throw new Error('INVALID_AUDIT_INPUT');
  }
}

/** Process-local reference for the append-only reducer. Snapshots are detached;
 * there are deliberately no update/delete methods. Restoring audits alone does
 * not restore tasks, payments, approvals, or other StateStore state.
 */
export class AuditLog {
  private entries: AuditEntry[];
  constructor(entries: readonly AuditEntry[] = []) {
    const status = verifyChain(entries);
    if (!status.valid) throw new Error(`AUDIT_CHAIN_BROKEN:${status.firstBrokenSeq}`);
    this.entries = structuredClone([...entries]);
  }
  append(input: AuditInput): AuditEntry { return this.appendMany([input])[0]!; }
  appendMany(inputs: readonly AuditInput[]): AuditEntry[] {
    const pending: AuditEntry[] = [];
    const ids = new Set(this.entries.map(entry => entry.id));
    let previous = this.entries.at(-1)?.hash ?? AUDIT_GENESIS_HASH;
    for (const input of inputs) {
      validateInput(input);
      const seq = this.entries.length + pending.length + 1;
      const { ts, actor, seat, action, ruleIds, policyVersion, refs, route, decision, latencyMs, costUsd } = input;
      const id = input.id ?? `audit:${seq}`;
      if (!id || ids.has(id)) throw new Error('AUDIT_ID_CONFLICT');
      const body = JSON.parse(canonicalAuditJson({ ts, actor, seat, action, ruleIds, policyVersion,
        refs, route, decision, latencyMs, costUsd, inputs: input.inputs ?? {},
        seq, id, prevHash: previous })) as Omit<AuditEntry, 'hash'>;
      const entry = { ...body, hash: hashAudit(body) };
      pending.push(entry); ids.add(id); previous = entry.hash;
    }
    this.entries.push(...pending);
    return structuredClone(pending);
  }
  list(sinceSeq = 0): AuditEntry[] {
    if (!Number.isSafeInteger(sinceSeq) || sinceSeq < 0) throw new Error('INVALID_AUDIT_CURSOR');
    return structuredClone(this.entries.filter(entry => entry.seq > sinceSeq));
  }
  get(id: string): AuditEntry | undefined { return structuredClone(this.entries.find(entry => entry.id === id)); }
  verifyChain(): ChainStatus { return verifyChain(this.entries); }
}
