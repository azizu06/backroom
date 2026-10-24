import { describe, expect, it } from 'vitest';
import { approvalWindowMs, ControllerApprovals, MemoryStateStore } from '@backroom/orchestrator';
import { TestAuthenticator } from '../../../orchestrator/src/approvals/testing/authenticator';
import { createApprovalHTTP } from './http';
import { createGateway } from '../gateway/http';
import { MemoryGatewayStore } from '../gateway/store';
import { createApprovalBridge } from './gateway';
import { approvalDemoCall } from './testing/call';
import { inboxIds } from './inbox';

const origin = 'http://localhost:3020';
function request(path: string, body: unknown, requestOrigin = origin) {
  return new Request(`${origin}${path}`, { method: 'POST', headers: { origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function setup() {
  const state = new MemoryStateStore();
  let now = 1000;
  const service = new ControllerApprovals(state, { origin, rpID: 'localhost', enrollmentSecret: 'test-enrollment' }, () => now);
  const handler = createApprovalHTTP(() => service, () => origin, inboxIds);
  const gatewayStore = new MemoryGatewayStore([approvalDemoCall()]);
  const gateway = createGateway({ secret: () => 'test-tool', store: gatewayStore, approvalBridge: createApprovalBridge(state, () => now) });
  let seq = 0;
  const tool = async (name: string, fields: Record<string, unknown> = {}) => gateway(name, new Request(`${origin}/api/tools/${name}`, {
    method: 'POST', headers: { authorization: 'Bearer test-tool', 'Content-Type': 'application/json' },
    body: JSON.stringify({ call_id: 'approval-demo', webhook_request_id: `r${++seq}`, ...fields }),
  }));
  return { state, service, handler, tool, gatewayStore, advance: (ms = 60_000) => { now += ms; } };
}

describe('M6 HTTP and gateway boundary', () => {
  it('shows real server evidence, writes the desk target, and relays timeout without a renderer', async () => {
    const { state, handler, tool, advance } = setup();
    const proposed = await tool('propose_plan', { installments: 4, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
    const escalation = await proposed.json();
    expect(escalation).toMatchObject({ kind: 'ESCALATE', can_confirm: false, approval_path: `/approve/${escalation.escalation_id}` });
    const view = await handler('approval', escalation.escalation_id, 'view', new Request(`${origin}/view`));
    const row = (await view.json()).escalation;
    expect(row).toMatchObject({ amountCents: 495000, principalCents: 480000, lateFeeCents: 15000,
      ruleIds: ['MAX_INSTALLMENTS'], requestedTerms: { installments: 4 }, status: 'pending' });
    expect(row.quote.text).toBe('A payment plan may not exceed the saved Collections maximum installment count, initially two; ask Dana for an exception.');
    expect((await state.getAgent('collections-1'))?.targetAnchor).toBe('Dana_desk');
    expect(await (await tool('check_approval', { escalation_id: row.id })).json()).toMatchObject({ approval_status: 'pending' });
    advance(60_000);
    expect(await (await tool('check_approval', { escalation_id: row.id })).json()).toMatchObject({ approval_status: 'pending', can_confirm: false });
    advance(approvalWindowMs() - 60_000);
    expect(await (await tool('check_approval', { escalation_id: row.id })).json()).toMatchObject({
      approval_status: 'expired', may_reask: true, can_confirm: false, speak: expect.stringContaining('call propose_plan again'),
    });
    expect((await state.listAudit()).filter(a => a.action === 'escalation_expired')).toHaveLength(1);
    expect((await state.listAudit()).filter(a => a.action === 'pending_owner')).toHaveLength(0);
  });

  it('reproduces the dead-end call: expiry, one re-ask, a second refusal, and no approval without a passkey', async () => {
    const { state, service, tool, advance } = setup();
    const auth = new TestAuthenticator();
    const enrolled = await service.registrationOptions('test-enrollment');
    await service.register('test-enrollment', enrolled.challengeId, auth.registration(enrolled.options.challenge));
    const plan = { installments: 4, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 };
    const first = await (await tool('propose_plan', plan)).json();
    expect(first).toMatchObject({ kind: 'ESCALATE', can_confirm: false });
    expect((await tool('check_approval', { escalation_id: first.escalation_id, approved: true, method: 'passkey' })).status).toBe(400);
    await expect(service.decide(first.escalation_id, 'fake', { verified: true, method: 'passkey' } as never)).rejects.toThrow();
    expect((await state.getEscalation(first.escalation_id))?.status).toBe('pending');
    const challenge = await service.decisionOptions(first.escalation_id, { kind: 'Approve' });
    advance(approvalWindowMs());
    const expired = await (await tool('check_approval', { escalation_id: first.escalation_id })).json();
    expect(expired).toMatchObject({ approval_status: 'expired', may_reask: true, can_confirm: false });
    expect(expired.speak).toContain('call propose_plan again');
    expect(expired.speak).not.toContain('email');
    await expect(service.decide(first.escalation_id, challenge.challengeId, auth.assertion(challenge.options.challenge))).rejects.toThrow();
    expect((await state.getEscalation(first.escalation_id))?.status).toBe('expired');
    expect((await state.getEscalation(first.escalation_id))?.method).toBeUndefined();
    const second = await (await tool('propose_plan', plan)).json();
    expect(second).toMatchObject({ kind: 'ESCALATE', can_confirm: false, approval_path: `/approve/${second.escalation_id}` });
    expect(second.escalation_id).not.toBe(first.escalation_id);
    expect(await (await tool('propose_plan', plan)).json()).toMatchObject({ kind: 'DENY', rule_ids: ['ESCALATION_OPEN'], can_confirm: false });
    advance(approvalWindowMs());
    const again = await (await tool('check_approval', { escalation_id: second.escalation_id })).json();
    expect(again).toMatchObject({ approval_status: 'expired', may_reask: false, can_confirm: false });
    expect(again.speak).toContain('Do not send another request');
    expect(again.speak).not.toContain('email');
    expect(await (await tool('propose_plan', plan)).json()).toMatchObject({ kind: 'DENY', rule_ids: ['ESCALATION_RETRY_USED'], can_confirm: false });
    expect((await state.listAudit()).filter(a => a.action === 'decide_escalation')).toHaveLength(0);
  });

  it.each([
    ['controller', 'register-options', { secret: 'wrong' }, origin, 403],
    ['controller', 'register-options', { secret: 'test-enrollment' }, 'https://evil.example', 403],
    ['approval', 'decide', { challengeId: 'fake', response: { verified: true, method: 'passkey' } }, origin, 403],
    ['approval', 'decide', { decision: 'Approve', method: 'passkey' }, origin, 400],
  ] as const)('rejects unauthorized %s/%s', async (scope, action, body, from, status) => {
    const { handler } = setup();
    const response = await handler(scope, 'e1', action, request('/test', body, from));
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('never exposes decide_escalation to voice, including claimed passkey flags', async () => {
    const { tool, gatewayStore } = setup();
    const before = await gatewayStore.transact('approval-demo', call => structuredClone(call.escalations));
    // #30: an unknown tool on a known call pauses it for a human (ESCALATE); it still decides nothing.
    const response = await tool('decide_escalation', { decision: 'Approve' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: 'ESCALATE', can_confirm: false, rule_ids: ['UNRECOGNIZED_REQUEST'] });
    const after = await gatewayStore.transact('approval-demo', call => call);
    expect(after.escalations).toEqual(before);
    expect(after.status).not.toBe('active');
    expect((await tool('check_approval', { escalation_id: 'fake', method: 'passkey', approved: true })).status).toBe(400);
  });

  it('lists gateway escalations only to a passkey-signed-in controller session', async () => {
    const { service, handler, tool } = setup();
    const auth = new TestAuthenticator();
    const enrolled = await service.registrationOptions('test-enrollment');
    await service.register('test-enrollment', enrolled.challengeId, auth.registration(enrolled.options.challenge));
    const escalation = await (await tool('propose_plan', { installments: 4, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 })).json();
    const inbox = (cookie?: string) => handler('controller', '', 'inbox', new Request(`${origin}/api/controller/inbox`, cookie ? { headers: { cookie } } : {}));
    expect((await inbox()).status).toBe(401);
    expect((await inbox('backroom_controller=guess')).status).toBe(401);
    expect((await handler('controller', '', 'session-options', request('/x', {}, 'https://evil.example'))).status).toBe(403);
    const { options, challengeId } = await (await handler('controller', '', 'session-options', request('/x', {}))).json();
    const forged = await handler('controller', '', 'session', request('/x', { challengeId, response: { verified: true, method: 'passkey' } }));
    expect(forged.status).toBe(403);
    expect(forged.headers.get('set-cookie')).toBeNull();
    const again = await (await handler('controller', '', 'session-options', request('/x', {}))).json();
    const signedIn = await handler('controller', '', 'session', request('/x', { challengeId: again.challengeId, response: auth.assertion(again.options.challenge) }));
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.get('set-cookie')!;
    expect(cookie).toMatch(/^backroom_controller=[\w-]{43}; Path=\/api\/controller; Max-Age=43200; HttpOnly; SameSite=Strict$/);
    const session = cookie.split(';')[0]!;
    const listed = await (await inbox(session)).json();
    expect(listed.escalations.map((e: { id: string }) => e.id)).toContain(escalation.escalation_id);
    expect(await (await handler('controller', '', 'view', new Request(`${origin}/view`, { headers: { cookie: session } }))).json())
      .toEqual({ registered: true, signedIn: true });
    // The session cannot decide: a decision still needs its own bound passkey assertion.
    const decide = await handler('approval', escalation.escalation_id, 'decide', new Request(`${origin}/decide`, { method: 'POST',
      headers: { origin, cookie: session, 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId: again.challengeId, response: {} }) }));
    expect(decide.status).toBe(403);
    expect((await service.get(escalation.escalation_id)).status).toBe('pending');
  });
});
