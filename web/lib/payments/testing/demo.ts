import { MemoryStateStore, PaymentService } from '@backroom/orchestrator';
import { FakeDemoBank } from '../../../../orchestrator/src/core-demo/bank';
import seed from '../../../../fixtures/company/northfield.json';
import { createGateway } from '../../gateway/http';
import { MemoryGatewayStore } from '../../gateway/store';
import { approvalDemoCall } from '../../approvals/testing/call';
import { authorizedPaymentLink } from '../authorization';
import { installPaymentService } from '../runtime';
import { installGatewayStore } from '../../gateway/runtime';

/** Headless/offline rehearsal only: real gateway + SDK + reducers, fake bank HTTP. */
export async function installPaymentDemo() {
  const invoice = seed.arInvoices.find(row => row.id === '1042')!;
  const state = new MemoryStateStore();
  const call = approvalDemoCall('payment-demo');
  call.receivable = { principalCents: invoice.principalCents, lateFeeCents: invoice.lateFeeCents };
  const bootstrapStore = new MemoryGatewayStore([call], state);
  const gateway = createGateway({ store: bootstrapStore, secret: () => 'local-offline-demo' });
  const tool = async (name: string, args: object) => {
    const response = await gateway(name, new Request(`http://demo.invalid/api/tools/${name}`, { method: 'POST',
      headers: { authorization: 'Bearer local-offline-demo', 'content-type': 'application/json' },
      body: JSON.stringify({ call_id: call.callId, webhook_request_id: name, ...args }) }));
    if (!response.ok) throw new Error('PAYMENT_DEMO_GATEWAY_FAILED');
    return response.json();
  };
  const plan = await tool('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
  await tool('send_payment_link', { plan_id: plan.plan_id });
  // Finalize fixture capabilities before installing the store; never rename a committed code owner.
  const seededCall = await bootstrapStore.transact(call.callId, row => row);
  const link = seededCall.links[0]!;
  const generatedId = link.id;
  link.id = 'payment-demo-1042';
  link.path = '/pay/payment-demo-1042';
  for (const delivery of seededCall.outbox) {
    if (delivery.type === 'send_payment_link' && delivery.linkId === generatedId) delivery.linkId = link.id;
  }
  const gatewayStore = new MemoryGatewayStore([seededCall], state);
  installGatewayStore(gatewayStore);
  await state.registerAgent('payment-demo-bookkeeper', 'collections', Date.now());
  await state.insertInvoice({ id: invoice.id, kind: 'ar', state: 'promised' });
  await state.enqueueTask({ id: 'reconcile-demo-1042', seatId: 'collections', refs: [invoice.id],
    idempotencyKey: 'ar:1042:1', steps: [] });
  // An earlier company reset's rehearsal left its deposit under the old invoice-only memo; this link must ignore it.
  const bank = new FakeDemoBank();
  await bank.deposit({ accountId: 'fake-demo-account', invoiceId: invoice.id, installment: 1, amountCents: 99000 });
  const service: PaymentService = new PaymentService({ bank, accountId: 'fake-demo-account', lookup: async id => {
    const stored = await gatewayStore.findPaymentCall(id); return stored && authorizedPaymentLink(stored, id);
  }, onPosted: async id => {
    const now = Date.now();
    await state.heartbeat('payment-demo-bookkeeper', now);
    const lease = await state.claimTask('payment-demo-bookkeeper', now, 12000);
    if (!lease) return;
    await service.reconcile(id, state, lease, 'promised');
    await state.completeTask(lease, 'done', Date.now());
  } });
  installPaymentService(service);
}
