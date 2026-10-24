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
  const gatewayStore = new MemoryGatewayStore([call], state);
  const gateway = createGateway({ store: gatewayStore, secret: () => 'local-offline-demo' });
  const tool = async (name: string, args: object) => {
    const response = await gateway(name, new Request(`http://demo.invalid/api/tools/${name}`, { method: 'POST',
      headers: { authorization: 'Bearer local-offline-demo', 'content-type': 'application/json' },
      body: JSON.stringify({ call_id: call.callId, webhook_request_id: name, ...args }) }));
    if (!response.ok) throw new Error('PAYMENT_DEMO_GATEWAY_FAILED');
    return response.json();
  };
  const plan = await tool('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
  await tool('send_payment_link', { plan_id: plan.plan_id });
  await gatewayStore.transact(call.callId, row => { row.links[0]!.id = 'payment-demo-1042'; row.links[0]!.path = '/pay/payment-demo-1042'; });
  installGatewayStore(gatewayStore);
  await state.registerAgent('payment-demo-bookkeeper', 'collections', Date.now());
  await state.insertInvoice({ id: invoice.id, kind: 'ar', state: 'promised' });
  await state.enqueueTask({ id: 'reconcile-demo-1042', seatId: 'collections', refs: [invoice.id],
    idempotencyKey: 'ar:1042:1', steps: [] });
  const service: PaymentService = new PaymentService({ bank: new FakeDemoBank(), accountId: 'fake-demo-account', lookup: async id => {
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
