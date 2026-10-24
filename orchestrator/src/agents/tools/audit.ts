import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuditEntry, StateStore } from '../../store';
import type { DomainTool, HandoffRequest, Json, ToolContext } from '../contracts';

/** Server-authored case membership and correction counter, never model arguments.
 * refs must identify this case specifically (invoice/task ids), not a shared vendor. */
export interface AuditCase {
  refs: readonly string[];
  correctionCount: number;
}
export interface AuditDependencies {
  store: Pick<StateStore, 'listAudit' | 'getAudit' | 'verifyAuditChain' | 'getPolicy' | 'getTask' | 'getPayment' | 'getEscalation' | 'appendAudit'>;
  loadCase(caseId: string): Promise<AuditCase>;
  /** PayablesSeat stores receipt ids in completion audits rather than StateStore payments.
   * Bind to a trusted receipt archive/provider lookup; absence fails closed. No bank data returned. */
  loadReceipt?(receiptId: string): Promise<{ id: string; status: string } | undefined>;
  now?: () => number;
}
interface MissingEvidence {
  auditId: string;
  kind: 'receipt' | 'approval' | 'policy' | 'chain' | 'audit';
  item: string;
  responsibleRole: 'payables' | 'collections' | 'reconciler';
}
interface Verification {
  decision: 'ALLOW' | 'ESCALATE';
  auditIds: string[];
  moneyAuditIds: string[];
  missing: MissingEvidence[];
  correctionCount: number;
}
const empty = z.object({}).strict();
const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,200}$/);
const receiptInput = z.object({ auditId: identifier }).strict();
const summaryInput = z.object({
  summary: z.string().trim().min(1).max(1000), citations: z.array(identifier).min(1).max(100),
}).strict();
const moneyActions = new Set(['pay_invoice', 'nessie_completed', 'x402_testnet_completed', 'payment_uncertain']);
const completedActions = new Set(['nessie_completed', 'x402_testnet_completed']);

async function current(ctx: ToolContext) {
  if (ctx.activation.role !== 'auditor') throw new Error('AUDITOR_CAPABILITY_REQUIRED');
  ctx.activation.signal.throwIfAborted();
  await ctx.assertCurrent();
}
function text(value: unknown): string | undefined { return typeof value === 'string' && value.length ? value : undefined; }
function owner(entry: AuditEntry): MissingEvidence['responsibleRole'] {
  return entry.seat === 'collections' ? 'collections' : 'payables';
}
function projection(entry: AuditEntry): Json {
  return { id: entry.id, action: entry.action, decision: entry.decision ?? null,
    policyVersion: entry.policyVersion, ruleIds: entry.ruleIds };
}
async function evidence(ctx: ToolContext, deps: AuditDependencies) {
  await current(ctx);
  const binding = await deps.loadCase(ctx.activation.caseId);
  if (!binding.refs.length || !Number.isSafeInteger(binding.correctionCount) || binding.correctionCount < 0) {
    throw new Error('INVALID_AUDIT_CASE');
  }
  const all = await deps.store.listAudit();
  const entries = all.filter(row => row.refs.some(ref => binding.refs.includes(ref)) && row.action !== 'case_summary');
  await current(ctx);
  return { binding, entries };
}
/** Match the same business action, not just a shared vendor/case or a nearby timestamp. */
function sameAction(a: AuditEntry, b: AuditEntry, refs: readonly string[]) {
  const task = text(a.inputs?.taskId);
  if (task) return b.inputs?.taskId === task && b.inputs?.cursor === a.inputs?.cursor;
  return !b.inputs?.taskId && a.refs.some(ref => refs.includes(ref) && b.refs.includes(ref));
}
async function receiptFor(entry: AuditEntry, entries: AuditEntry[], binding: AuditCase, deps: AuditDependencies) {
  const taskId = text(entry.inputs?.taskId);
  if (taskId) {
    const task = await deps.store.getTask(taskId);
    if (!task || !task.refs.some(ref => binding.refs.includes(ref)) || !task.idempotencyKey) return;
    const receipt = await deps.store.getPayment(task.idempotencyKey);
    const id = text(receipt?.result.externalId) ?? text(receipt?.result.id) ?? text(receipt?.result.receiptId);
    if (receipt?.key === task.idempotencyKey && receipt.fingerprint && id && receipt.result.status === 'completed') {
      return { id, status: 'completed' };
    }
    return;
  }
  const completion = completedActions.has(entry.action) ? entry : entries.find(row =>
    completedActions.has(row.action) && row.seq > entry.seq && sameAction(entry, row, binding.refs));
  const id = text(completion?.inputs?.receiptId);
  if (!id || !deps.loadReceipt) return;
  const receipt = await deps.loadReceipt(id);
  if (receipt?.id === id && receipt.status === 'completed') return { id, status: 'completed' };
}
async function verify(ctx: ToolContext, deps: AuditDependencies): Promise<Verification> {
  const { entries, binding } = await evidence(ctx, deps);
  const missing: MissingEvidence[] = [];
  const chain = await deps.store.verifyAuditChain();
  if (!chain.valid) missing.push({ auditId: '', kind: 'chain', item: `audit-chain:${chain.firstBrokenSeq}`, responsibleRole: 'reconciler' });
  if (!entries.length) missing.push({ auditId: '', kind: 'audit', item: `audit:${ctx.activation.caseId}`, responsibleRole: 'reconciler' });
  const money = entries.filter(row => moneyActions.has(row.action) && (row.decision === 'ALLOW' ||
    completedActions.has(row.action) || row.action === 'payment_uncertain'));
  for (const entry of money) {
    const add = (kind: MissingEvidence['kind'], item: string) => missing.push({ auditId: entry.id, kind, item, responsibleRole: owner(entry) });
    try {
      const policy = await deps.store.getPolicy(entry.policyVersion);
      if (policy.policyVersion !== entry.policyVersion || entry.policyVersion < 1) add('policy', `policy:${entry.policyVersion}`);
    } catch { add('policy', `policy:${entry.policyVersion}`); }
    if (!await receiptFor(entry, entries, binding, deps)) add('receipt', `receipt:${entry.id}`);
    if (completedActions.has(entry.action) && !entries.some(row => row.action === 'pay_invoice' &&
        row.decision === 'ALLOW' && row.seq < entry.seq && sameAction(entry, row, binding.refs))) {
      add('audit', `decision:${entry.id}`);
    }
    const taskId = text(entry.inputs?.taskId);
    const task = taskId ? await deps.store.getTask(taskId) : undefined;
    const escalationId = text(entry.inputs?.escalationId) ?? task?.escalationId;
    // Routine code-allowed payments do not require a fabricated human approval.
    // Where an escalation exists, only its stored passkey decision counts as evidence.
    if (escalationId) {
      const approval = await deps.store.getEscalation(escalationId);
      if (!approval || approval.status !== 'approved' || approval.method !== 'passkey' || !approval.credentialId ||
          approval.decision?.kind !== 'Approve' || approval.policyVersion !== entry.policyVersion ||
          !approval.evidenceRefs.some(ref => binding.refs.includes(ref)) || !approval.decidedAt ||
          approval.decidedAt < approval.createdAt || approval.decidedAt > entry.ts || approval.decidedAt > approval.expiresAt) add('approval', `approval:${escalationId}`);
    }
  }
  await current(ctx);
  return { decision: missing.length ? 'ESCALATE' : 'ALLOW', auditIds: entries.map(row => row.id),
    moneyAuditIds: money.map(row => row.id), missing, correctionCount: binding.correctionCount };
}

/** Dispatcher/store guard: apply immediately before committing an Auditor handoff.
 * This is evidence repair only, never authority to replay a money action. */
export async function validateAuditorCorrection(ctx: ToolContext, request: HandoffRequest, deps: AuditDependencies): Promise<void> {
  const result = await verify(ctx, deps);
  if (result.correctionCount >= 2 || !result.missing.some(item => item.auditId &&
      item.responsibleRole === request.to && request.artifactRefs.includes(item.auditId) && request.reason.includes(item.item))) {
    throw new Error('AUDITOR_CORRECTION_NOT_ALLOWED');
  }
  await current(ctx);
}

function tool<I>(name: string, description: string, input: z.ZodType<I>, run: (ctx: ToolContext, input: I) => Promise<Json>): DomainTool<I, Json> {
  return { name, description, input, execute: async (ctx, args) => {
    await current(ctx);
    const parsed = input.parse(args);
    const result = await run(ctx, parsed);
    await current(ctx);
    return result;
  } };
}
export function createAuditTools(deps: AuditDependencies) {
  const readAudit = tool('read_audit', 'Read safe audit facts for the current case; ids are the only valid citations.', empty, async ctx => {
    const { entries } = await evidence(ctx, deps);
    return { entries: entries.map(projection) };
  });
  const verifyChain = tool('verify_chain', 'Check audit integrity, policy snapshots, receipts and any required passkey evidence. Returns exact missing items and owners.', empty,
    async ctx => {
      const result = await verify(ctx, deps);
      return { ...result, missing: result.missing.map(item => ({ ...item })) };
    });
  const getReceipt = tool('get_receipt', 'Read a completed receipt for a money audit id belonging to this case. No payment capability.', receiptInput, async (ctx, { auditId }): Promise<Json> => {
    const { entries, binding } = await evidence(ctx, deps);
    const entry = entries.find(row => row.id === auditId && moneyActions.has(row.action));
    if (!entry) return { decision: 'DENY', reason: 'AUDIT_NOT_IN_CASE' };
    const receipt = await receiptFor(entry, entries, binding, deps);
    return receipt ? { decision: 'ALLOW', auditId, receipt } : { decision: 'ESCALATE', auditId, missingItem: `receipt:${auditId}` };
  });
  const recordSummary = tool('record_case_summary', 'Record a short close-out on the audit wall only after all checks pass. Cite every fact as [entry:ID]; supply the same ids in citations.', summaryInput,
    async (ctx, { summary, citations }): Promise<Json> => {
      const result = await verify(ctx, deps);
      if (result.decision !== 'ALLOW') return { decision: 'DENY', reason: 'EVIDENCE_INCOMPLETE' };
      const inline = [...summary.matchAll(/\[entry:([A-Za-z0-9_.:-]+)\]/g)].map(match => match[1]!);
      const cited = new Set(citations);
      if (!inline.length || citations.some(id => !result.auditIds.includes(id) || !inline.includes(id)) ||
          inline.some(id => !cited.has(id)) || result.moneyAuditIds.some(id => !cited.has(id)) ||
          /(?:entry|audit)\s*:/i.test(summary.replace(/\[entry:[A-Za-z0-9_.:-]+\]/g, ''))) {
        return { decision: 'DENY', reason: 'INVALID_CITATIONS' };
      }
      const id = `case-summary:${createHash('sha256').update(ctx.activation.activationId).digest('hex')}`;
      const prior = await deps.store.getAudit(id);
      if (prior) {
        if (prior.inputs?.caseId !== ctx.activation.caseId || prior.inputs?.summary !== summary ||
            JSON.stringify(prior.inputs?.citations) !== JSON.stringify([...cited])) return { decision: 'DENY', reason: 'SUMMARY_CONFLICT' };
        return { decision: 'ALLOW', summaryAuditId: prior.id, artifactRefs: [prior.id] };
      }
      const policy = await deps.store.getPolicy();
      await current(ctx);
      const row = await deps.store.appendAudit({
        id, ts: (deps.now ?? Date.now)(), actor: 'claude', seat: 'controller',
        action: 'case_summary', ruleIds: [], policyVersion: policy.policyVersion, refs: [ctx.activation.caseId, ...cited],
        route: 'claude-agent-sdk', latencyMs: 0, costUsd: 0,
        inputs: { caseId: ctx.activation.caseId, role: 'auditor', summary, citations: [...cited], activationId: ctx.activation.activationId },
      });
      return { decision: 'ALLOW', summaryAuditId: row.id, artifactRefs: [row.id] };
    });
  return { readAudit, verifyChain, getReceipt, recordSummary };
}
