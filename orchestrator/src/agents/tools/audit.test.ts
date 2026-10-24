import { describe, expect, it } from 'vitest';
import { MemoryStateStore, type AuditInput } from '../../store';
import type { ToolContext } from '../contracts';
import { createAuditTools } from './audit';

const ctx: ToolContext = {
  activation: { caseId: 'INV-42', taskId: 'audit-task', activationId: 'audit-run', role: 'auditor',
    leaseOwner: 'runner', leaseToken: 1, llmGeneration: 1, artifactRefs: [], credentialOwnerId: 'owner',
    signal: new AbortController().signal },
  assertCurrent: async () => {},
};
const input: AuditInput = { ts: 1, actor: 'code', seat: 'payables', action: 'pay_invoice', decision: 'ALLOW',
  policyVersion: 1, ruleIds: ['PAYABLES_ALLOW'], refs: ['INV-42'], route: 'code', latencyMs: 0, costUsd: 0 };

async function setup() {
  const store = new MemoryStateStore();
  const payment = await store.appendAudit(input);
  const tools = createAuditTools({ store, loadCase: async () => ({ refs: ['INV-42'], correctionCount: 0 }) });
  return { store, payment, tools };
}

describe('Auditor evidence tools', () => {
  it('returns the exact missing receipt to Payables and refuses close-out', async () => {
    const { tools, payment, store } = await setup();
    const verification = await tools.verifyChain.execute(ctx, {});
    expect(verification).toMatchObject({ decision: 'ESCALATE', missing: [
      { auditId: payment.id, kind: 'receipt', item: `receipt:${payment.id}`, responsibleRole: 'payables' },
    ] });
    const summary = await tools.recordSummary.execute(ctx, { summary: `Paid [entry:${payment.id}].`, citations: [payment.id] });
    expect(summary).toMatchObject({ decision: 'DENY', reason: 'EVIDENCE_INCOMPLETE' });
    expect((await store.listAudit()).filter(row => row.action === 'case_summary')).toEqual([]);
  });
});

describe('Auditor close-out citations', () => {
  it('rejects invented and cross-case ids, then appends a cited summary once', async () => {
    const { store, tools } = await setup();
    // A denied money action has no receipt requirement and may be explained historically.
    const held = await store.appendAudit({ ...input, refs: ['held-case'], decision: 'DENY' });
    const other = await store.appendAudit({ ...input, refs: ['other-case'], decision: 'DENY' });
    const heldCtx = { ...ctx, activation: { ...ctx.activation, caseId: 'held-case' } };
    const heldTools = createAuditTools({ store, loadCase: async () => ({ refs: ['held-case'], correctionCount: 0 }) });
    for (const id of ['audit:invented', other.id]) {
      expect(await heldTools.recordSummary.execute(heldCtx, { summary: `Held [entry:${id}].`, citations: [id] }))
        .toMatchObject({ decision: 'DENY', reason: 'INVALID_CITATIONS' });
    }
    const args = { summary: `Payment was denied [entry:${held.id}].`, citations: [held.id] };
    const result = await heldTools.recordSummary.execute(heldCtx, args);
    expect(result).toMatchObject({ decision: 'ALLOW' });
    expect(await heldTools.recordSummary.execute(heldCtx, args)).toEqual(result);
    const summaries = (await store.listAudit()).filter(row => row.action === 'case_summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.inputs).toMatchObject(args);
    expect(await tools.getReceipt.execute(ctx, { auditId: other.id })).toEqual({ decision: 'DENY', reason: 'AUDIT_NOT_IN_CASE' });
  });
});

describe('Auditor money trail', () => {
  it('retrieves an archived receipt, checks all money citations and closes the paid case', async () => {
    const { store, payment } = await setup();
    const completed = await store.appendAudit({ ...input, ts: 2, actor: 'system', action: 'nessie_completed',
      inputs: { receiptId: 'bank-42', destinationAccountId: 'PRIVATE-BANK-DATA' } });
    const tools = createAuditTools({ store, loadCase: async () => ({ refs: ['INV-42'], correctionCount: 0 }),
      loadReceipt: async id => id === 'bank-42' ? { id, status: 'completed' } : undefined });
    expect(await tools.verifyChain.execute(ctx, {})).toMatchObject({ decision: 'ALLOW', missing: [] });
    expect(await tools.getReceipt.execute(ctx, { auditId: payment.id })).toEqual({ decision: 'ALLOW', auditId: payment.id,
      receipt: { id: 'bank-42', status: 'completed' } });
    expect(JSON.stringify(await tools.readAudit.execute(ctx, {}))).not.toContain('PRIVATE-BANK-DATA');
    expect(await tools.recordSummary.execute(ctx, { summary: `Paid [entry:${payment.id}].`, citations: [payment.id] }))
      .toMatchObject({ decision: 'DENY', reason: 'INVALID_CITATIONS' });
    expect(await tools.recordSummary.execute(ctx, {
      summary: `Payment allowed [entry:${payment.id}], completed receipt verified [entry:${completed.id}].`,
      citations: [payment.id, completed.id],
    })).toMatchObject({ decision: 'ALLOW' });
  });

  it('requires the real policy snapshot and stored passkey evidence, never a model assertion', async () => {
    const { store } = await setup();
    const action = await store.appendAudit({ ...input, policyVersion: 99, inputs: { escalationId: 'missing-approval' } });
    const tools = createAuditTools({ store, loadCase: async () => ({ refs: ['INV-42'], correctionCount: 0 }) });
    expect(await tools.verifyChain.execute(ctx, {})).toMatchObject({ decision: 'ESCALATE', missing: expect.arrayContaining([
      { auditId: action.id, kind: 'policy', item: 'policy:99', responsibleRole: 'payables' },
      { auditId: action.id, kind: 'approval', item: 'approval:missing-approval', responsibleRole: 'payables' },
    ]) });
    await expect(tools.getReceipt.execute(ctx, { auditId: action.id, approved: true } as { auditId: string })).rejects.toThrow();
  });

  it('does not accept a completed receipt without an earlier code ALLOW decision', async () => {
    const store = new MemoryStateStore();
    const completed = await store.appendAudit({ ...input, action: 'nessie_completed', inputs: { receiptId: 'bank-42' } });
    const tools = createAuditTools({ store, loadCase: async () => ({ refs: ['INV-42'], correctionCount: 0 }),
      loadReceipt: async id => ({ id, status: 'completed' }) });
    expect(await tools.verifyChain.execute(ctx, {})).toMatchObject({ decision: 'ESCALATE', missing: [
      { auditId: completed.id, kind: 'audit', item: `decision:${completed.id}`, responsibleRole: 'payables' },
    ] });
  });
});

describe('Auditor worker receipt adapter', () => {
  it.each(['completed', 'pending'])('uses the trusted task payment key and holds %s receipts appropriately', async status => {
    const store = new MemoryStateStore();
    await store.registerAgent('worker', 'payables', 1);
    await store.enqueueTask({ id: 'payment-task', seatId: 'payables', refs: ['INV-42'], idempotencyKey: 'PRIVATE-KEY',
      steps: [{ kind: 'nessie', action: { type: 'pay_invoice' }, context: {}, input: {} }] });
    const lease = (await store.claimTask('worker', 1, 10000))!;
    await store.reservePayment(lease, 'PRIVATE-KEY', 'PRIVATE-FINGERPRINT', 2);
    await store.recordPayment(lease, { key: 'PRIVATE-KEY', fingerprint: 'PRIVATE-FINGERPRINT',
      result: { externalId: 'bank-42', status, account: 'PRIVATE-BANK' } }, 3);
    const payment = await store.appendAudit({ ...input, inputs: { taskId: 'payment-task', cursor: 0 } });
    const tools = createAuditTools({ store, loadCase: async () => ({ refs: ['INV-42'], correctionCount: 0 }) });
    const receipt = await tools.getReceipt.execute(ctx, { auditId: payment.id });
    expect(receipt).toMatchObject({ decision: status === 'completed' ? 'ALLOW' : 'ESCALATE' });
    expect(JSON.stringify(receipt)).not.toMatch(/PRIVATE/);
    expect(await tools.verifyChain.execute(ctx, {})).toMatchObject({ decision: status === 'completed' ? 'ALLOW' : 'ESCALATE' });
  });
});
