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
it('registers an unverified voice call into the same gateway and reconciles its ALLOW link', async () => {
  const { getGatewayStore, handleTool } = await import('../gateway/runtime');
  const { resolvePaymentCode } = await import('../payments/delivery');
  const { randomUUID } = await import('node:crypto');
  process.env.TOOL_GATEWAY_SECRET = 'voice-test';
  runtime = await createDemoRuntime();
  const callId = randomUUID();
  await runtime.registerVoiceCall(callId);
  const invoke = async (tool: string, args = {}) => (await handleTool(tool, new Request('http://localhost', {
    method: 'POST', headers: { authorization: 'Bearer voice-test' },
    body: JSON.stringify({ call_id: callId, webhook_request_id: randomUUID(), ...args }),
  }))).json();
  expect((await invoke('get_invoice_context')).rule_ids).toEqual(['IDENTITY_REQUIRED']);
  await invoke('verify_identity_result', { result: 'confirmed' });
  const plan = await invoke('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
  const sent = await invoke('send_payment_link', { plan_id: plan.plan_id });
  const link = await resolvePaymentCode(getGatewayStore(), sent.short_code);
  expect(link?.amountCents).toBe(247500);
  const id = link!.path.split('/').at(-1)!;
  expect((await getPaymentService().pay(id)).status).toBe('partially_paid');
  expect((await getStateStore().getPayment('ar:1042:1'))?.result.amountCents).toBe(247500);
  delete process.env.TOOL_GATEWAY_SECRET;
});
