import { expect, it } from 'vitest';
import { MemoryStateStore } from '@backroom/orchestrator';
import { createPolicyHTTP } from './http';
import { createGateway } from '../gateway/http';
import { MemoryGatewayStore } from '../gateway/store';
import { approvalDemoCall } from '../approvals/testing/call';

const origin = 'http://localhost:3031', pin = 'owner-test-pin';
const limits = { maxInstallments: 3, minFirstPct: 50, maxPlanDays: 30, maxPaymentCents: 200000 };
const req = (body?: unknown, key = pin, from = origin) => new Request(`${origin}/api/policy`, {
  method: body === undefined ? 'GET' : 'POST', headers: { 'x-policy-demo-pin': key, origin: from, 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
it('owner save changes the next gateway offer and both decision audits cite their actual version', async () => {
  const state = new MemoryStateStore();
  const edit = createPolicyHTTP({ store: () => state, pin: () => pin, origin: () => origin });
  const gateway = createGateway({ secret: () => 'voice-secret', store: new MemoryGatewayStore([approvalDemoCall(), approvalDemoCall('next-call')], state),
    currentPolicy: () => state.getPolicy() });
  const offer = (id: string, installments = 3) => gateway('propose_plan', new Request(`${origin}/api/tools/propose_plan`, {
    method: 'POST', headers: { authorization: 'Bearer voice-secret', 'content-type': 'application/json' },
    body: JSON.stringify({ call_id: id === 'before' ? 'approval-demo' : 'next-call', webhook_request_id: id, installments, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 }),
  }));
  expect(await (await offer('before')).json()).toMatchObject({ kind: 'ESCALATE', can_confirm: false });
  expect((await edit(req({ expectedVersion: 1, limits }))).status).toBe(200);
  expect(await (await offer('after')).json()).toMatchObject({ kind: 'ALLOW', can_confirm: true });
  const over = await (await offer('over', 4)).json();
  expect(over.kind).toBe('ESCALATE');
  expect((await state.listAudit()).at(-1)?.inputs?.decision).toMatchObject({ quote: { text: expect.stringContaining('3 in v2') } });
  expect((await state.listAudit()).map(a => [a.actor, a.policyVersion])).toEqual([['code', 1], ['human', 2], ['code', 2], ['code', 2]]);
});

it('rejects voice credentials, origin forgery, arbitrary policy fields, invalid limits and stale saves without writes', async () => {
  const state = new MemoryStateStore();
  const edit = createPolicyHTTP({ store: () => state, pin: () => pin, origin: () => origin });
  expect((await edit(req({ expectedVersion: 1, limits }, 'voice-secret'))).status).toBe(401);
  expect((await edit(req({ expectedVersion: 1, limits }, pin, 'https://evil.example'))).status).toBe(403);
  for (const bad of [{ ...limits, maxInstallments: 0 }, { ...limits, maxInstallments: 2.5 }, { ...limits, minFirstPct: 101 },
    { ...limits, maxPlanDays: -1 }, { ...limits, maxPaymentCents: 0 }, { ...limits, maxPaymentCents: 2.5 }, { ...limits, actions: ['pay_invoice'] }]) {
    expect((await edit(req({ expectedVersion: 1, limits: bad }))).status).toBe(400);
  }
  expect((await edit(req({ expectedVersion: 1, limits, actor: 'human' }))).status).toBe(400);
  expect(await state.listAudit()).toEqual([]);
  expect((await edit(req({ expectedVersion: 1, limits }))).status).toBe(200);
  expect((await edit(req({ expectedVersion: 1, limits }))).status).toBe(409);
  expect((await state.listAudit()).length).toBe(1);
});
it('fails closed without config and limits online PIN guessing for one minute', async () => {
  const state = new MemoryStateStore(); let clock = 1;
  const edit = createPolicyHTTP({ store: () => state, pin: () => pin, origin: () => origin, now: () => clock });
  for (let i = 0; i < 5; i++) expect((await edit(req(undefined, 'bad'))).status).toBe(401);
  expect((await edit(req())).status).toBe(429);
  clock += 60000;
  expect((await edit(req())).status).toBe(200);
  const disabled = createPolicyHTTP({ store: () => state, pin: () => undefined, origin: () => origin });
  expect((await disabled(req())).status).toBe(503);
});
