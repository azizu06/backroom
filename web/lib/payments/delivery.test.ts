import { expect, it, vi } from 'vitest';
import { MemoryGatewayStore } from '../gateway/store';
import { MemoryStateStore } from '@backroom/orchestrator';
import { approvalDemoCall } from '../approvals/testing/call';
import { createGateway } from '../gateway/http';
import { activePaymentDelivery, resolvePaymentCode } from './delivery';

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
  const active = await activePaymentDelivery(store);
  expect(active).toMatchObject({ code: sent.short_code, amountCents: 247500, expiresAt: sent.expires_at });
  expect(active).not.toHaveProperty('path');
  const linkId = (await store.findPaymentCode(sent.short_code))!.links[0]!.id;
  expect(await activePaymentDelivery(store, Date.now(), id => id === linkId)).toBeUndefined();
  expect(await activePaymentDelivery(store, Date.now(), id => id === 'another-link')).toEqual(active);
  // The paid page still resolves, so the payer can read the matched receipt.
  expect(await resolvePaymentCode(store, sent.short_code)).toMatchObject({ path: sent.link_path });
  expect(resolved).toMatchObject({ amountCents: 247500, path: sent.link_path });
  expect(await resolvePaymentCode(store, sent.short_code, sent.expires_at)).toBeUndefined();
  expect(await resolvePaymentCode(store, 'UNKNOWN')).toBeUndefined();
  await store.transact('approval-demo', call => { call.links[0]!.amountCents = 1; });
  expect(await resolvePaymentCode(store, sent.short_code)).toBeUndefined();
});
it('never publishes a loopback or non-HTTPS payment origin', async () => {
  const { paymentPublicOrigin } = await import('./delivery');
  const old = process.env.DEMO_PUBLIC_URL;
  const oldTunnel = process.env.DEMO_TUNNEL;
  try {
    delete process.env.DEMO_TUNNEL;
    for (const url of ['http://demo.example', 'https://localhost:3000', 'https://demo.example/_cartesia', 'https://u:p@demo.example']) {
      process.env.DEMO_PUBLIC_URL = url;
      expect(paymentPublicOrigin).toThrow();
    }
    process.env.DEMO_PUBLIC_URL = 'https://demo.example';
    expect(paymentPublicOrigin()).toEqual({ origin: 'https://demo.example', localOnly: false });
  } finally {
    if (old === undefined) delete process.env.DEMO_PUBLIC_URL; else process.env.DEMO_PUBLIC_URL = old;
    if (oldTunnel === undefined) delete process.env.DEMO_TUNNEL; else process.env.DEMO_TUNNEL = oldTunnel;
  }
});

it('publishes a loopback origin only when the supervisor marks the host offline', async () => {
  const { paymentPublicOrigin } = await import('./delivery');
  const oldUrl = process.env.DEMO_PUBLIC_URL;
  const oldTunnel = process.env.DEMO_TUNNEL;
  try {
    process.env.DEMO_TUNNEL = '0';
    for (const url of ['http://127.0.0.1:3300', 'http://localhost:3000', 'https://[::1]:3000']) {
      process.env.DEMO_PUBLIC_URL = url;
      expect(paymentPublicOrigin()).toEqual({ origin: url, localOnly: true });
    }
    process.env.DEMO_PUBLIC_URL = 'https://demo.example';
    expect(paymentPublicOrigin()).toEqual({ origin: 'https://demo.example', localOnly: false });
    for (const url of ['http://demo.example', 'http://127.0.0.1:3300/pay', 'http://127.0.0.1:3300?x=1', 'http://u:p@127.0.0.1:3300', 'http://0.0.0.0:3300',
      'http://localhost.example.com', 'http://127.0.0.1.example.com', 'http://127.example.com', 'http://127.0.0.256', 'https://localhost.attacker.example']) {
      process.env.DEMO_PUBLIC_URL = url;
      expect(paymentPublicOrigin).toThrow();
    }
    for (const tunnel of ['1', '', 'false', '00']) {
      process.env.DEMO_TUNNEL = tunnel;
      process.env.DEMO_PUBLIC_URL = 'http://127.0.0.1:3300';
      expect(paymentPublicOrigin).toThrow();
    }
  } finally {
    if (oldUrl === undefined) delete process.env.DEMO_PUBLIC_URL; else process.env.DEMO_PUBLIC_URL = oldUrl;
    if (oldTunnel === undefined) delete process.env.DEMO_TUNNEL; else process.env.DEMO_TUNNEL = oldTunnel;
  }
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
