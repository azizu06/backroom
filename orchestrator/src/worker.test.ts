import { MemoryFinanceRepository } from './payables/repository';
import { describe, expect, it } from 'vitest';
import { POLICY_SENTENCES, RULE_SENTENCES, type Decision } from '@backroom/policy';
import { MemoryStateStore, type NewTask } from './store';
import { SeatWorker } from './worker';
import { FakeEffects } from './effects';

const allow: Decision = { kind: 'ALLOW', ruleIds: ['IN_BADGE'], policyVersion: 3 };
const quote = (rule: 'NOT_IN_BADGE' | 'OVER_LIMIT') => ({ sentenceId: RULE_SENTENCES[rule], text: POLICY_SENTENCES[RULE_SENTENCES[rule]] });
const payment: NewTask = { id: 't1', seatId: 'payables', refs: ['invoice:1'], idempotencyKey: 'invoice:1:payment:1',
  steps: [{ kind: 'nessie', action: { type: 'pay_invoice' }, context: { policyVersion: 3 },
    input: { invoiceId: '1', vendorId: 'vendor:1', amountCents: 5000, sourceAccount: 'operating', destinationAccountId: 'approved-bank' } }] };

describe('seat worker policy gate', () => {
  it.each(['ALLOW', 'DENY', 'ESCALATE'] as const)('audits %s before any external effect', async kind => {
    const store = new MemoryStateStore();
    const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'vendor:1', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
    let auditedBeforeEffect = false;
    effects.beforeEffect = async () => { auditedBeforeEffect = (await store.listAudit()).find(entry => entry.decision)?.decision === 'ALLOW'; };
    const decision: Decision = kind === 'ALLOW' ? allow : kind === 'DENY'
      ? { ...allow, kind, reason: 'NOT_IN_BADGE', quote: quote('NOT_IN_BADGE') }
      : { ...allow, kind, reason: 'OVER_LIMIT', toHuman: 'dana', quote: quote('OVER_LIMIT') };
    const worker = new SeatWorker({ id: 'payables-1', seat: 'payables', store, effects, now: () => 0,
      evaluate: () => decision });
    await worker.start(); await store.enqueueTask(payment); await worker.tick();
    expect((await store.listAudit()).find(entry => entry.decision)).toMatchObject({ actor: 'code', seat: 'payables',
      action: 'pay_invoice', decision: kind, policyVersion: 3, ruleIds: ['IN_BADGE'],
      refs: ['invoice:1'], route: 'code' });
    expect(effects.calls).toHaveLength(kind === 'ALLOW' ? 1 : 0);
    if (kind === 'ALLOW') {
      expect(auditedBeforeEffect).toBe(true);
      expect((await store.getTask('t1'))?.status).toBe('done');
    } else if (kind === 'ESCALATE') {
      expect((await store.getAgent('payables-1'))).toMatchObject({ state: 'walking', targetAnchor: 'dana_desk' });
      await worker.tick();
      expect((await store.getAgent('payables-1'))?.state).toBe('waiting');
      expect((await store.getEscalation('escalation:t1'))?.status).toBe('pending');
    } else expect((await store.getTask('t1'))?.status).toBe('denied');
  });
});

describe('payment crash recovery', () => {
  it('reuses the provider key after a crash between payment and receipt persistence', async () => {
    let now = 0;
    const store = new MemoryStateStore();
    const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'vendor:1', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
    const old = new SeatWorker({ id: 'old', seat: 'payables', store, effects, now: () => now, evaluate: () => allow });
    await old.start(); await store.enqueueTask(payment);
    effects.beforeEffect = async () => { now = 16000; await store.reapExpired(now); };
    await expect(old.tick()).rejects.toThrow('LEASE_LOST');
    expect((await store.getTask('t1'))?.status).toBe('queued');
    expect(await store.getPayment(payment.idempotencyKey!)).toBeUndefined();
    const replacement = new SeatWorker({ id: 'new', seat: 'payables', store, effects, now: () => now, evaluate: () => allow });
    await replacement.start(); await replacement.tick();
    expect(effects.calls).toHaveLength(1);
    expect((await store.getTask('t1'))?.status).toBe('done');
    await store.enqueueTask({ ...payment, id: 'replay' });
    await replacement.tick();
    expect(effects.calls).toHaveLength(1);
    expect((await store.getTask('replay'))?.status).toBe('done');
  });

  it('reserves a payment fingerprint atomically before any provider call', async () => {
    const store = new MemoryStateStore();
    await store.registerAgent('a', 'payables', 0);
    await store.enqueueTask(payment);
    const lease = (await store.claimTask('a', 0, 10000))!;
    const attempts = await Promise.allSettled([
      store.reservePayment(lease, payment.idempotencyKey!, 'fingerprint-a', 0),
      store.reservePayment(lease, payment.idempotencyKey!, 'fingerprint-b', 0),
    ]);
    expect(attempts.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(attempts[1]).toMatchObject({ reason: new Error('PAYMENT_KEY_CONFLICT') });
  });
});

describe('worker runtime heartbeat', () => {
  it('keeps a slow call leased and on_call, then returns idle and clears its timers', async () => {
    const { vi } = await import('vitest');
    vi.useFakeTimers(); vi.setSystemTime(0);
    const store = new MemoryStateStore();
    const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'vendor:1', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
    let finishCall!: () => void;
    const call = new Promise<void>(resolve => { finishCall = resolve; });
    effects.beforeEffect = () => call;
    await store.enqueueTask({ id: 'call', seatId: 'collections', refs: ['invoice:2'], steps: [
      { kind: 'dial', action: { type: 'call_client' }, context: { policyVersion: 3 }, input: { clientId: 'client:2' } },
    ] });
    const controller = new AbortController();
    const worker = new SeatWorker({ id: 'collections-1', seat: 'collections', store, effects, evaluate: () => allow });
    const running = worker.run(controller.signal);
    try {
      await vi.advanceTimersByTimeAsync(16000);
      expect((await store.getAgent('collections-1'))).toMatchObject({ state: 'on_call', heartbeatAt: 15000 });
      expect((await store.getTask('call'))?.leaseExpiresAt).toBe(27000);
      finishCall(); await vi.advanceTimersByTimeAsync(0);
      expect((await store.getAgent('collections-1'))?.state).toBe('idle');
      expect((await store.getTask('call'))?.status).toBe('done');
    } finally {
      finishCall(); controller.abort(); await running;
      expect(vi.getTimerCount()).toBe(0); vi.useRealTimers();
    }
  });
});

describe('async store adapter races', () => {
  it('does not stop a healthy worker when completion overtakes an in-flight lease renewal', async () => {
    let releaseRenew!: () => void;
    let renewStarted!: () => void;
    const renewing = new Promise<void>(resolve => { renewStarted = resolve; });
    const renewGate = new Promise<void>(resolve => { releaseRenew = resolve; });
    class DelayedStore extends MemoryStateStore {
      override async renewLease(...args: Parameters<MemoryStateStore['renewLease']>) {
        renewStarted(); await renewGate; return super.renewLease(...args);
      }
    }
    const store = new DelayedStore();
    const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'vendor:1', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
    let finishEffect!: () => void;
    let effectStarted!: () => void;
    const started = new Promise<void>(resolve => { effectStarted = resolve; });
    const effectGate = new Promise<void>(resolve => { finishEffect = resolve; });
    effects.beforeEffect = () => { effectStarted(); return effectGate; };
    const worker = new SeatWorker({ id: 'a', seat: 'payables', store, effects, now: () => 0, evaluate: () => allow });
    await worker.start(); await store.enqueueTask(payment);
    const ticking = worker.tick(); await started;
    const pulsing = worker.pulse(); await renewing;
    finishEffect(); await ticking; releaseRenew();
    await expect(pulsing).resolves.toBeUndefined();
    expect((await store.getTask('t1'))?.status).toBe('done');
  });
});

describe('effect execution boundary', () => {
  it('does not execute when the preceding policy audit cannot be persisted', async () => {
    class UnavailableAuditStore extends MemoryStateStore {
      override async appendAudit(): Promise<never> { throw new Error('STORE_UNAVAILABLE'); }
    }
    const store = new UnavailableAuditStore();
    const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'vendor:1', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
    const worker = new SeatWorker({ id: 'a', seat: 'payables', store, effects, now: () => 0, evaluate: () => allow });
    await worker.start(); await store.enqueueTask(payment);
    await expect(worker.tick()).rejects.toThrow('STORE_UNAVAILABLE');
    expect(effects.calls).toHaveLength(0);
  });

  it('persists the multi-step cursor and checks policy again before Apify', async () => {
    const store = new MemoryStateStore();
    const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'vendor:1', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
    let permitted = true;
    const worker = new SeatWorker({ id: 'vendor', seat: 'vendor_onboarding', store, effects, now: () => 0,
      evaluate: () => permitted ? allow : { kind: 'DENY', ruleIds: ['NOT_IN_BADGE'], policyVersion: 4,
        reason: 'NOT_IN_BADGE', quote: quote('NOT_IN_BADGE') } });
    await worker.start();
    await store.enqueueTask({ id: 'vendor-check', seatId: 'vendor_onboarding', refs: ['vendor:1'], steps: [
      { kind: 'crs', action: { type: 'run_crs' }, input: { vendorId: 'vendor:1' }, context: { policyVersion: 3 } },
      { kind: 'apify', action: { type: 'run_apify' }, input: { domain: 'example.com' }, context: { policyVersion: 4 } },
    ] });
    await worker.tick();
    expect((await store.getTask('vendor-check'))?.cursor).toBe(1);
    permitted = false; await worker.tick();
    expect(effects.calls.map(call => call.kind)).toEqual(['crs']);
    expect((await store.getTask('vendor-check'))?.status).toBe('denied');
    expect((await store.listAudit()).filter(entry => entry.decision).at(-1)).toMatchObject({ action: 'run_apify', policyVersion: 4, decision: 'DENY' });
  });
});
