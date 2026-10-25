import { afterEach, expect, it } from 'vitest';
import { NessieClient } from '@backroom/nessie';
import { PaymentService } from '@backroom/orchestrator';
import { authorizedPaymentLink } from './authorization';
import { installPaymentService } from './runtime';
import { MemoryStateStore } from '@backroom/orchestrator';
import { GET as activePayment } from '../../app/api/pay/active/route';
import { GET as paymentCode } from '../../app/p/[code]/route';
import { approvalDemoCall } from '../approvals/testing/call';
import { createGateway } from '../gateway/http';
import { getGatewayStore, installGatewayStore } from '../gateway/runtime';
import { MemoryGatewayStore } from '../gateway/store';

const previous = getGatewayStore();
const oldUrl = process.env.DEMO_PUBLIC_URL;
const oldTunnel = process.env.DEMO_TUNNEL;

afterEach(() => {
  installGatewayStore(previous);
  if (oldUrl === undefined) delete process.env.DEMO_PUBLIC_URL; else process.env.DEMO_PUBLIC_URL = oldUrl;
  if (oldTunnel === undefined) delete process.env.DEMO_TUNNEL; else process.env.DEMO_TUNNEL = oldTunnel;
});

async function authorizeLink() {
  const store = new MemoryGatewayStore([approvalDemoCall()], new MemoryStateStore());
  const gateway = createGateway({ secret: () => 'test', store });
  const invoke = async (tool: string, args: object, nonce: number) => (await gateway(tool, new Request('http://local', {
    method: 'POST', headers: { authorization: 'Bearer test' },
    body: JSON.stringify({ call_id: 'approval-demo', webhook_request_id: String(nonce), ...args }),
  }))).json();
  const plan = await invoke('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 }, 1);
  const sent = await invoke('send_payment_link', { plan_id: plan.plan_id }, 2);
  installGatewayStore(store);
  return sent as { short_code: string; link_path: string };
}

it('publishes the loopback pay link and redirects the short code only while the host is offline', async () => {
  const sent = await authorizeLink();
  process.env.DEMO_TUNNEL = '0';
  process.env.DEMO_PUBLIC_URL = 'http://127.0.0.1:3300';
  const active = await activePayment();
  const body = await active.json();
  expect(active.status).toBe(200);
  expect(body.active).toMatchObject({
    code: sent.short_code,
    url: `http://127.0.0.1:3300/p/${sent.short_code}`,
    localOnly: true,
    amountCents: 247500,
    bankLine: 'Offline bank · no card charged',
  });
  expect(body.active.qr).toMatch(/^data:image\/png;base64,/);
  const redirect = await paymentCode(new Request(`http://127.0.0.1:3300/p/${sent.short_code}`), { params: Promise.resolve({ code: sent.short_code.toLowerCase() }) });
  expect(redirect.status).toBe(303);
  expect(redirect.headers.get('Location')).toBe(`http://127.0.0.1:3300${sent.link_path}`);
});

it('uses the live Nessie line only when DEMO_LIVE selects that adapter and no mock service is installed', async () => {
  const sent = await authorizeLink();
  process.env.DEMO_TUNNEL = '0';
  process.env.DEMO_PUBLIC_URL = 'http://127.0.0.1:3300';
  process.env.DEMO_LIVE = '1';
  try {
    const body = await (await activePayment()).json();
    expect(body.active.bankLine).toBe('Nessie bank · no card charged');
    expect(body.active.code).toBe(sent.short_code);
  } finally { delete process.env.DEMO_LIVE; }
});

it('keeps a public HTTPS link unmarked and refuses a remote name that only looks local', async () => {
  const sent = await authorizeLink();
  delete process.env.DEMO_TUNNEL;
  process.env.DEMO_PUBLIC_URL = 'https://demo.example';
  const body = await (await activePayment()).json();
  expect(body.active.url).toBe(`https://demo.example/p/${sent.short_code}`);
  expect(body.active).not.toHaveProperty('localOnly');
  process.env.DEMO_TUNNEL = '0';
  process.env.DEMO_PUBLIC_URL = 'http://localhost.example.com';
  const refused = await activePayment();
  expect(refused.status).toBe(503);
  expect(await refused.json()).toEqual({ error: 'PAYMENT_DELIVERY_UNAVAILABLE' });
  const redirect = await paymentCode(new Request('http://localhost.example.com/p/' + sent.short_code), { params: Promise.resolve({ code: sent.short_code }) });
  expect(redirect.status).toBe(503);
});

it('clears toast and nav readiness after payment is recorded while keeping the receipt page resolvable', async () => {
  const sent = await authorizeLink();
  process.env.DEMO_TUNNEL = '0';
  process.env.DEMO_PUBLIC_URL = 'http://127.0.0.1:3300';
  const call = (await getGatewayStore().findPaymentCode!(sent.short_code))!;
  const link = call.links[0]!;
  const root = globalThis as typeof globalThis & { backroomPaymentService?: PaymentService };
  const previousService = root.backroomPaymentService;
  const bank = new NessieClient({ apiKey: 'test', claims: { claim: async () => true },
    fetch: async (_url, init) => init?.method === 'POST' ? Response.json({ objectCreated: { _id: 'deposit-1', ...JSON.parse(String(init.body)) } }) : Response.json(String(_url).includes('/deposits') ? [] : { balance: 0 }) });
  const service = new PaymentService({ bank, accountId: 'test-account', lookup: async id => authorizedPaymentLink(call, id) });
  installPaymentService(service);
  try {
    expect((await (await activePayment()).json()).active.code).toBe(sent.short_code);
    await service.pay(link.id);
    // Both the office toast and nav poll this same projection.
    expect(await (await activePayment()).json()).toEqual({ active: null });
    const redirect = await paymentCode(new Request(`http://127.0.0.1:3300/p/${sent.short_code}`), { params: Promise.resolve({ code: sent.short_code }) });
    expect(redirect.status).toBe(303);
  } finally { root.backroomPaymentService = previousService; }
});
