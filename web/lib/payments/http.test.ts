import { expect, it } from 'vitest';
import { PaymentService } from '@backroom/orchestrator';
import { FakeDemoBank } from '../../../orchestrator/src/core-demo/bank';
import { paymentHttp } from './http';
import { authorizedPaymentLink } from './authorization';
import { approvalDemoCall } from '../approvals/testing/call';
import { MemoryGatewayStore } from '../gateway/store';
import { createGateway } from '../gateway/http';
import { MemoryStateStore } from '@backroom/orchestrator';

async function setup() {
  const calls = new MemoryGatewayStore([approvalDemoCall()], new MemoryStateStore());
  const gateway = createGateway({ secret: () => 'test', store: calls });
  async function tool(name: string, data: object) {
    const response = await gateway(name, new Request(`http://localhost/api/tools/${name}`, { method: 'POST',
      headers: { authorization: 'Bearer test', 'content-type': 'application/json' },
      body: JSON.stringify({ call_id: 'approval-demo', webhook_request_id: name, ...data }) }));
    expect(response.status).toBe(200); return response.json();
  }
  const plan = await tool('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
  const sent = await tool('send_payment_link', { plan_id: plan.plan_id });
  const id = sent.link_path.split('/').pop();
  const service = new PaymentService({ bank: new FakeDemoBank(), accountId: 'fake', lookup: async id => {
    const call = await calls.findPaymentCall(id); return call && authorizedPaymentLink(call, id);
  } });
  return { id, calls, service, handle: paymentHttp(() => service) };
}
it('reads the real gateway ALLOW link, rejects client amounts and posts with an empty same-origin request', async () => {
  const { id, handle } = await setup(); const url = `http://localhost/api/pay/${id}`;
  const view = await handle(new Request(url), id);
  expect(view.headers.get('cache-control')).toBe('no-store');
  expect(await view.json()).toMatchObject({ amountCents: 247500 });
  const post = (body: object, origin = 'http://localhost') => new Request(url, { method: 'POST',
    headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await handle(post({ amountCents: 1 }), id)).status).toBe(400);
  expect((await handle(post({}, 'https://attacker.invalid'), id)).status).toBe(403);
  const paid = await handle(post({}), id);
  expect(await paid.json()).toMatchObject({ amountCents: 247500, payment: { amountCents: 247500, status: 'pending_reconciliation' } });
  expect((await handle(new Request('http://localhost/api/pay/missing'), 'missing')).status).toBe(404);
});
it('rejects a link if its stored amount or ALLOW evidence has been changed', async () => {
  const { id, calls, handle } = await setup();
  await calls.transact('approval-demo', call => { call.links[0]!.amountCents = 1; });
  expect((await handle(new Request(`http://localhost/api/pay/${id}`), id)).status).toBe(404);
});
