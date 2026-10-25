import { afterEach, describe, expect, it } from 'vitest';
import { ControllerApprovals, MemoryStateStore, PaymentService } from '@backroom/orchestrator';
import { FakeDemoBank } from '../../../orchestrator/src/core-demo/bank';
import { TestAuthenticator } from '../../../orchestrator/src/approvals/testing/authenticator';
import { GET as activePayment } from '../../app/api/pay/active/route';
import { GET as paymentCode } from '../../app/p/[code]/route';
import { createApprovalBridge } from '../approvals/gateway';
import { createApprovalHTTP } from '../approvals/http';
import { approvalDemoCall } from '../approvals/testing/call';
import { createGateway } from '../gateway/http';
import { getGatewayStore, installGatewayStore } from '../gateway/runtime';
import { MemoryGatewayStore } from '../gateway/store';
import { authorizedPaymentLink } from './authorization';
import { paymentHttp } from './http';

const origin = 'http://127.0.0.1:3300';
const danaOrigin = 'http://localhost:3020';
const CALL = 'approval-demo';
const previous = getGatewayStore();
const oldUrl = process.env.DEMO_PUBLIC_URL;
const oldTunnel = process.env.DEMO_TUNNEL;
afterEach(() => {
  installGatewayStore(previous);
  if (oldUrl === undefined) delete process.env.DEMO_PUBLIC_URL; else process.env.DEMO_PUBLIC_URL = oldUrl;
  if (oldTunnel === undefined) delete process.env.DEMO_TUNNEL; else process.env.DEMO_TUNNEL = oldTunnel;
});

async function liveCall() {
  process.env.DEMO_TUNNEL = '0';
  process.env.DEMO_PUBLIC_URL = origin;
  const state = new MemoryStateStore();
  const approvals = new ControllerApprovals(state, { origin: danaOrigin, rpID: 'localhost', enrollmentSecret: 'test-enrollment' });
  const auth = new TestAuthenticator();
  const enrolled = await approvals.registrationOptions('test-enrollment');
  await approvals.register('test-enrollment', enrolled.challengeId, auth.registration(enrolled.options.challenge));
  const approvalHttp = createApprovalHTTP(() => approvals, () => danaOrigin);
  const store = new MemoryGatewayStore([approvalDemoCall(CALL)], state);
  installGatewayStore(store);
  const gateway = createGateway({ secret: () => 'tool', store, approvalBridge: createApprovalBridge(state) });
  let seq = 0;
  const tool = async (name: string, fields: Record<string, unknown> = {}) => (await gateway(name, new Request(`${origin}/api/tools/${name}`, {
    method: 'POST', headers: { authorization: 'Bearer tool', 'Content-Type': 'application/json' },
    body: JSON.stringify({ call_id: CALL, webhook_request_id: `r${++seq}`, ...fields }) }))).json();
  const approve = async (id: string) => {
    const challenge = await approvals.decisionOptions(id, { kind: 'Approve' });
    return approvalHttp('approval', id, 'decide', new Request(`${danaOrigin}/decide`, { method: 'POST',
      headers: { origin: danaOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: challenge.challengeId, response: auth.assertion(challenge.options.challenge) }) }));
  };
  const payments = new PaymentService({ bank: new FakeDemoBank(), accountId: 'fake', lookup: async id => {
    const call = await store.findPaymentCall(id); return call && authorizedPaymentLink(call, id);
  } });
  const pay = paymentHttp(() => payments);
  return { store, tool, approve, pay };
}

async function delivered(call: Awaited<ReturnType<typeof liveCall>>, sent: { short_code: string; link_path: string; amount_cents: number }) {
  const active = await (await activePayment()).json();
  expect(active.active).toMatchObject({ code: sent.short_code, amountCents: sent.amount_cents, url: `${origin}/p/${sent.short_code}` });
  const redirect = await paymentCode(new Request(`${origin}/p/${sent.short_code}`), { params: Promise.resolve({ code: sent.short_code }) });
  expect(redirect.status).toBe(303);
  expect(redirect.headers.get('Location')).toBe(`${origin}${sent.link_path}`);
  const id = sent.link_path.split('/').pop()!;
  const url = `${origin}/api/pay/${id}`;
  expect(await (await call.pay(new Request(url), id)).json()).toMatchObject({ amountCents: sent.amount_cents });
  const paid = await call.pay(new Request(url, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{}' }), id);
  expect(paid.status).toBe(200);
  expect(await paid.json()).toMatchObject({ payment: { amountCents: sent.amount_cents, status: 'pending_reconciliation' } });
}

describe('a payment link minted after Dana approves the plan', () => {
  it('shows in the panel, resolves its short code and pays the exact first payment', async () => {
    const call = await liveCall();
    const escalated = await call.tool('propose_plan', { installments: 7, first_payment_pct: 20, duration_days: 30, waive_fee: false, discount_pct: 0 });
    expect(escalated).toMatchObject({ kind: 'ESCALATE', rule_ids: ['MAX_INSTALLMENTS'] });
    expect((await call.approve(escalated.escalation_id)).status).toBe(200);
    const approved = await call.tool('check_approval', { escalation_id: escalated.escalation_id });
    expect(approved).toMatchObject({ kind: 'ALLOW', approval_status: 'approved', rule_ids: ['MAX_INSTALLMENTS', 'DANA_APPROVED'] });
    const sent = await call.tool('send_payment_link', { plan_id: approved.plan_id });
    // NF-027: 20% of principal + late fee, a whole-dollar amount the integer-only sandbox bank accepts.
    expect(sent).toMatchObject({ kind: 'RECORDED', amount_cents: 99000 });
    await delivered(call, sent);
  });

  it('rounds the live call\'s $742.50 first payment up to $743.00 and pays it through the sandbox bank', async () => {
    const call = await liveCall();
    const escalated = await call.tool('propose_plan', { installments: 37, first_payment_pct: 15, duration_days: 0, waive_fee: false, discount_pct: 0 });
    expect((await call.approve(escalated.escalation_id)).status).toBe(200);
    const approved = await call.tool('check_approval', { escalation_id: escalated.escalation_id });
    expect(approved).toMatchObject({ kind: 'ALLOW', plan: { totalCents: 495000, firstPaymentCents: 74300 } });
    const sent = await call.tool('send_payment_link', { plan_id: approved.plan_id });
    expect(sent).toMatchObject({ kind: 'RECORDED', amount_cents: 74300, speak: expect.stringContaining('$743.00') });
    await delivered(call, sent);
  });

  it('still delivers a plan allowed directly by propose_plan', async () => {
    const call = await liveCall();
    const plan = await call.tool('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
    expect(plan).toMatchObject({ kind: 'ALLOW' });
    const sent = await call.tool('send_payment_link', { plan_id: plan.plan_id });
    expect(sent).toMatchObject({ kind: 'RECORDED', amount_cents: 247500 });
    await delivered(call, sent);
  });

  it('refuses a check_approval audit without Dana’s approval rule, or with changed terms', async () => {
    const call = await liveCall();
    const escalated = await call.tool('propose_plan', { installments: 7, first_payment_pct: 15, duration_days: 30, waive_fee: false, discount_pct: 0 });
    await call.approve(escalated.escalation_id);
    const approved = await call.tool('check_approval', { escalation_id: escalated.escalation_id });
    const sent = await call.tool('send_payment_link', { plan_id: approved.plan_id });
    const id = sent.link_path.split('/').pop()!;
    const authorized = async () => authorizedPaymentLink((await call.store.findPaymentCall(id))!, id);
    expect(await authorized()).toMatchObject({ planId: approved.plan_id, amountCents: 74300 });
    await call.store.transact(CALL, c => { c.audits.find(a => a.id === approved.audit_id)!.ruleIds = ['MAX_INSTALLMENTS']; });
    expect(await authorized()).toBeUndefined();
    await call.store.transact(CALL, c => {
      const row = c.audits.find(a => a.id === approved.audit_id)!;
      row.ruleIds = ['MAX_INSTALLMENTS', 'DANA_APPROVED'];
      row.plan = { ...row.plan!, installments: 8 };
    });
    expect(await authorized()).toBeUndefined();
  });
});
