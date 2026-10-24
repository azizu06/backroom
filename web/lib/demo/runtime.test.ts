import { afterEach, expect, it, vi } from 'vitest';
import { getStateStore, MemoryStateStore } from '@backroom/orchestrator';
import { getPaymentService } from '../payments/runtime';
import { createDemoRuntime } from './runtime';

let runtime: Awaited<ReturnType<typeof createDemoRuntime>> | undefined;
afterEach(async () => { await runtime?.stop(); vi.restoreAllMocks(); });
it('resets synthetic company, gateway approvals and payments into one shared state', async () => {
  runtime = await createDemoRuntime();
  const first = runtime.status();
  expect(first.payPath).toMatch(/^\/pay\//);
  const id = first.approvePath!.split('/').at(-1)!;
  expect(await getStateStore().getEscalation(id)).toMatchObject({ status: 'pending', invoiceId: '1042' });
  expect((await getStateStore().getAgent('demo:collections'))?.seatId).toBe('collections');
  const linkId = first.payPath!.split('/').at(-1)!;
  // Simulate a slow reducer response after enqueue commits: the seat must not steal this task.
  const enqueue = MemoryStateStore.prototype.enqueueTask;
  vi.spyOn(MemoryStateStore.prototype, 'enqueueTask').mockImplementation(async function (this: MemoryStateStore, task) {
    await enqueue.call(this, task);
    if (task.id.startsWith('demo:reconcile:')) await new Promise(resolve => setTimeout(resolve, 200));
  });
  const payment = await getPaymentService().pay(linkId);
  expect(payment.status).toBe('partially_paid');
  expect((await getStateStore().getPayment('ar:1042:1'))?.result.amountCents).toBe(247500);
  await getStateStore().setLlmEnabled(true);
  await runtime.reset();
  expect(runtime.status().llmEnabled).toBe(false);
  expect(await getStateStore().getPayment('ar:1042:1')).toBeUndefined();
  await expect(getPaymentService().view(linkId)).rejects.toThrow('PAYMENT_LINK_NOT_FOUND');
  expect(await getStateStore().getEscalation(id)).toBeUndefined();
  expect((await getStateStore().verifyAuditChain()).valid).toBe(true);
});
