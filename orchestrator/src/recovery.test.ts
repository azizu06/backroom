import { MemoryFinanceRepository } from './payables/repository';
import { describe, expect, it } from 'vitest';
import { FakeEffects, MemoryStateStore, SeatWorker, type NewTask } from './index';

const payment: NewTask = {
  id: 'recovery:1', seatId: 'payables', refs: ['invoice:recovery:1'],
  idempotencyKey: 'recovery:1:payment', steps: [{ kind: 'nessie',
    action: { type: 'pay_invoice' }, context: { policyVersion: 1, vendor: {
      id: 'vendor:recovery', inMaster: true, approved: true,
      pendingBankChange: false, knownDomain: 'example.com',
    } }, input: { invoice: { id: 'invoice:recovery:1', vendorId: 'vendor:recovery',
      amountCents: 5000, poMatched: true, account: 'operating',
      lineItems: [{ description: 'Service', quantity: 1, unitPriceCents: 5000 }],
    } } }],
};

describe('Payables recovery', () => {
  it.each([true, false])('takes over at exact lease expiry with models enabled=%s', async modelsEnabled => {
    let now = 0;
    const store = new MemoryStateStore();
    const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'vendor:recovery', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
    await store.setLlmEnabled(modelsEnabled);
    const worker = (id: string) => new SeatWorker({ id, seat: 'payables', store, effects,
      now: () => now, leaseMs: 1000, heartbeatMs: 100 });
    await store.enqueueTask(payment);
    const old = worker('old'); await old.start();
    // The provider has paid; the response arrives after this worker loses its lease.
    effects.beforeEffect = async () => { now = 1000; };
    await expect(old.tick()).rejects.toThrow('LEASE_LOST');
    await store.reapExpired(now);
    expect((await store.getTask(payment.id))?.status).toBe('queued');
    const replacement = worker('replacement'); await replacement.start();
    await replacement.tick();
    expect(effects.calls).toHaveLength(1);
    expect((await store.getTask(payment.id))).toMatchObject({ status: 'done', leaseToken: 2, cursor: 1 });
    expect((await store.listAudit()).find(entry => entry.action === 'task_resumed')).toMatchObject({
      refs: ['invoice:recovery:1', 'recovery:1'], inputs: {
        taskId: payment.id, workerId: 'replacement', leaseToken: 2, cursor: 0,
        priorAuditIds: modelsEnabled ? ['audit:1', 'audit:2'] : ['audit:2', 'audit:3'],
      },
    });
    if (!modelsEnabled) expect((await store.listAudit()).every(entry => entry.actor === 'code')).toBe(true);
    await expect(old.tick()).rejects.toThrow('LEASE_LOST');
    await store.enqueueTask({ ...payment, id: 'replay' });
    await replacement.tick();
    expect(effects.calls).toHaveLength(1);
    expect((await store.getTask('replay'))?.status).toBe('done');
  });
});

it('survives two successive lease losses on the same payment without paying again', async () => {
  let now = 0;
  let crashes = 2;
  class InterruptedStore extends MemoryStateStore {
    override async recordPayment(...args: Parameters<MemoryStateStore['recordPayment']>) {
      if (crashes-- > 0) now += 1000;
      return super.recordPayment(args[0], args[1], now);
    }
  }
  const store = new InterruptedStore();
  const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [{ id: 'vendor:recovery', domain: 'example.com', accountId: 'approved-bank', approved: true, revision: 1 }] }));
  await store.enqueueTask(payment);
  for (let generation = 1; generation <= 3; generation++) {
    const worker = new SeatWorker({ id: `worker:${generation}`, seat: 'payables', store, effects,
      now: () => now, leaseMs: 1000, heartbeatMs: 100 });
    await worker.start();
    if (generation < 3) {
      await expect(worker.tick()).rejects.toThrow('LEASE_LOST');
      await store.reapExpired(now);
      expect((await store.getTask(payment.id))?.status).toBe('queued');
    } else await worker.tick();
  }
  expect((await store.getTask(payment.id))).toMatchObject({ status: 'done', cursor: 1, leaseToken: 3 });
  expect(effects.calls).toHaveLength(1);
  expect((await store.listAudit()).filter(entry => entry.action === 'task_resumed')).toHaveLength(2);
});
