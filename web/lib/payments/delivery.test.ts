import { expect, it, vi } from 'vitest';
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
it('never publishes a loopback or non-HTTPS payment origin', async () => {
  const { paymentPublicOrigin } = await import('./delivery');
  const old = process.env.DEMO_PUBLIC_URL;
  try {
    for (const url of ['http://demo.example', 'https://localhost:3000', 'https://demo.example/_cartesia', 'https://u:p@demo.example']) {
      process.env.DEMO_PUBLIC_URL = url;
      expect(paymentPublicOrigin).toThrow();
    }
    process.env.DEMO_PUBLIC_URL = 'https://demo.example';
    expect(paymentPublicOrigin()).toBe('https://demo.example');
  } finally { if (old === undefined) delete process.env.DEMO_PUBLIC_URL; else process.env.DEMO_PUBLIC_URL = old; }
});

it('refuses to reannounce an expired code as a fresh payment page', async () => {
  const call = approvalDemoCall();
  const store = new MemoryGatewayStore([call], new MemoryStateStore());
  const gateway = createGateway({ secret: () => 'test', store });
  let n = 0;
  const invoke = async (tool: string, args: object) => (await gateway(tool, new Request('http://local', {
    method: 'POST', headers: { authorization: 'Bearer test' },
    body: JSON.stringify({ call_id: call.callId, webhook_request_id: String(++n), ...args }),
  }))).json();
  const plan = await invoke('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
  const sent = await invoke('send_payment_link', { plan_id: plan.plan_id });
  const clock = vi.spyOn(Date, 'now').mockReturnValue(sent.expires_at);
  try {
    expect((await invoke('send_payment_link', { plan_id: plan.plan_id })).rule_ids).toEqual(['PAYMENT_LINK_EXPIRED']);
    const { authorizedPaymentLink } = await import('./authorization');
    const stored = await store.findPaymentCode(sent.short_code);
    expect(authorizedPaymentLink(stored!, stored!.links[0]!.id)).toBeUndefined();
  } finally { clock.mockRestore(); }
});
