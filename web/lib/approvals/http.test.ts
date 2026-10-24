import { describe, expect, it } from 'vitest';
import { ControllerApprovals, MemoryStateStore } from '@backroom/orchestrator';
import { createApprovalHTTP } from './http';
import { createGateway } from '../gateway/http';
import { MemoryGatewayStore } from '../gateway/store';
import { createApprovalBridge } from './gateway';
import { approvalDemoCall } from './testing/call';

const origin = 'http://localhost:3020';
function request(path: string, body: unknown, requestOrigin = origin) {
  return new Request(`${origin}${path}`, { method: 'POST', headers: { origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function setup() {
  const state = new MemoryStateStore();
  let now = 1000;
  const service = new ControllerApprovals(state, { origin, rpID: 'localhost', enrollmentSecret: 'test-enrollment' }, () => now);
  const handler = createApprovalHTTP(() => service, () => origin);
  const gatewayStore = new MemoryGatewayStore([approvalDemoCall()]);
  const gateway = createGateway({ secret: () => 'test-tool', store: gatewayStore, approvalBridge: createApprovalBridge(state, () => now) });
  let seq = 0;
  const tool = async (name: string, fields: Record<string, unknown> = {}) => gateway(name, new Request(`${origin}/api/tools/${name}`, {
    method: 'POST', headers: { authorization: 'Bearer test-tool', 'Content-Type': 'application/json' },
    body: JSON.stringify({ call_id: 'approval-demo', webhook_request_id: `r${++seq}`, ...fields }),
  }));
  return { state, service, handler, tool, gatewayStore, advance: () => { now += 60_000; } };
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
    advance();
    expect(await (await tool('check_approval', { escalation_id: row.id })).json()).toMatchObject({ approval_status: 'pending_owner', speak: 'Dana will confirm by email today.', can_confirm: false });
    expect((await state.listAudit()).filter(a => a.action === 'pending_owner')).toHaveLength(1);
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
});
