import { expect, it } from 'vitest';
import { MemoryGatewayStore } from '../gateway/store';
import { MemoryStateStore } from '@backroom/orchestrator';
import { approvalDemoCall } from '../approvals/testing/call';
import { createGateway } from '../gateway/http';
import { resolvePaymentCode } from './delivery';

it('creates a short-lived code only from the ALLOW plan and binds resolution to its amount', async () => {
  const store = new MemoryGatewayStore([approvalDemoCall()], new MemoryStateStore());
  const gateway = createGateway({ secret: () => 'test', store });
  let nonce = 0;
  const invoke = async (tool: string, args: object) => (await gateway(tool, new Request('http://local', {
    method: 'POST', headers: { authorization: 'Bearer test' },
    body: JSON.stringify({ call_id: 'approval-demo', webhook_request_id: String(++nonce), ...args }),
  }))).json();
  expect((await invoke('send_payment_link', { plan_id: 'invented' })).kind).toBe('DENY');
  const plan = await invoke('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
  const sent = await invoke('send_payment_link', { plan_id: plan.plan_id });
  expect(sent.short_code).toMatch(/^[A-F0-9]{10}$/);
  const resolved = await resolvePaymentCode(store, sent.short_code.toLowerCase());
  expect(resolved).toMatchObject({ amountCents: 247500, path: sent.link_path });
  expect(await resolvePaymentCode(store, sent.short_code, sent.expires_at)).toBeUndefined();
  expect(await resolvePaymentCode(store, 'UNKNOWN')).toBeUndefined();
  await store.transact('approval-demo', call => { call.links[0]!.amountCents = 1; });
  expect(await resolvePaymentCode(store, sent.short_code)).toBeUndefined();
});
