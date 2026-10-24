import { afterEach, expect, it } from 'vitest';
import { getStateStore } from '@backroom/orchestrator';
import { getPaymentService } from '../payments/runtime';
import { createDemoRuntime } from './runtime';

let runtime: Awaited<ReturnType<typeof createDemoRuntime>> | undefined;
afterEach(async () => { await runtime?.stop(); });
it('resets synthetic company, gateway approvals and payments into one shared state', async () => {
  runtime = await createDemoRuntime();
  const first = runtime.status();
  expect(first.payPath).toMatch(/^\/pay\//);
  const id = first.approvePath!.split('/').at(-1)!;
  expect(await getStateStore().getEscalation(id)).toMatchObject({ status: 'pending', invoiceId: '1042' });
  expect((await getStateStore().getAgent('demo:collections'))?.seatId).toBe('collections');
  const linkId = first.payPath!.split('/').at(-1)!;
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
