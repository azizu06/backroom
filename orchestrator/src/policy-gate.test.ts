import { MemoryFinanceRepository } from './payables/repository';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, evaluate, type APInvoice, type Context } from '@backroom/policy';
import { evaluateStep } from './policy-gate';
import { FakeEffects, MemoryStateStore, SeatWorker } from './index';

const invoice: APInvoice = { id: 'invoice:1', vendorId: 'vendor:1', amountCents: 5000,
  lineItems: [{ description: 'Service', quantity: 1, unitPriceCents: 5000 }], poMatched: true, account: 'operating' };
const context: Context = { policy: DEFAULT_POLICY, policyVersion: 1,
  vendor: { id: 'vendor:1', inMaster: true, approved: true, pendingBankChange: false, knownDomain: 'example.com' } };

describe('real policy/effect binding', () => {
  it('evaluates the actual invoice rather than a cheaper proposed invoice', () => {
    expect(evaluateStep('payables', { kind: 'nessie', action: { type: 'pay_invoice', invoice },
      input: { invoice: { ...invoice, amountCents: 300000 } }, context }))
      .toMatchObject({ kind: 'ESCALATE', ruleIds: ['OVER_LIMIT'], policyVersion: 1 });
  });
  it('uses the real deny quote when an action would authorize a different effect', () => {
    const decision = evaluateStep('collections', { kind: 'nessie', action: { type: 'call_client' }, input: {}, context: {} });
    expect(decision).toEqual(evaluate('collections', { type: 'unknown_effect' }, {}));
    expect(decision).toMatchObject({ kind: 'DENY', ruleIds: ['NOT_IN_BADGE'], policyVersion: 1 });
  });
  it('uses the policy version guard and actual evaluated version', () => {
    expect(evaluateStep('payables', { kind: 'nessie', action: { type: 'pay_invoice' },
      input: { invoice }, context: { ...context, policyVersion: 2 } }))
      .toMatchObject({ kind: 'DENY', ruleIds: ['INVALID_INPUT'], policyVersion: 1 });
  });
  it.each(['ALLOW', 'DENY', 'ESCALATE'] as const)('runs real %s policy through the worker and persists its full decision', async kind => {
    const store = new MemoryStateStore();
    const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'vendor:1', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
    const input = { invoice: { ...invoice, ...(kind === 'ESCALATE' ? { amountCents: 300000 } : {}) } };
    const taskContext: Context = kind === 'DENY' ? { ...context, signals: { ofacHit: false },
      vendor: undefined } : context;
    const worker = new SeatWorker({ id: 'payables', seat: 'payables', store, effects, now: () => 0 });
    await worker.start();
    await store.enqueueTask({ id: 'payment', seatId: 'payables', refs: ['invoice:1'], idempotencyKey: 'payment:1',
      steps: [{ kind: 'nessie', action: { type: 'pay_invoice' }, context: taskContext, input }] });
    await worker.tick();
    const decision = evaluate('payables', { type: 'pay_invoice', ...input }, taskContext);
    expect(decision.kind).toBe(kind);
    expect((await store.listAudit()).find(entry => entry.decision)).toMatchObject({ decision: kind, policyVersion: 1,
      inputs: { action: { type: 'pay_invoice' }, effectInput: input, decision } });
    expect(effects.calls).toHaveLength(kind === 'ALLOW' ? 1 : 0);
    if (kind === 'ESCALATE') expect(await store.getAgent('payables')).toMatchObject({ state: 'walking', targetAnchor: 'Dana_desk' });
  });
});
