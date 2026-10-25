import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControllerApprovals, MemoryStateStore } from '@backroom/orchestrator';
import { MemoryHandoffStore, type AgentHandoffPublic } from '@backroom/orchestrator/agents';
import { TestAuthenticator } from '../../../orchestrator/src/approvals/testing/authenticator';
import { approvalDemoCall } from '../approvals/testing/call';
import { createApprovalBridge } from '../approvals/gateway';
import { createApprovalHTTP } from '../approvals/http';
import { createGateway } from '../gateway/http';
import { MemoryGatewayStore } from '../gateway/store';
import { installCallHandoffs } from './handoffs';
import { createVoicePresence, VOICE_AGENT } from './presence';

const origin = 'http://localhost:3020';
const CALL = '00000000-0000-4000-8000-0000000000cc';
const sevenInstallments = { installments: 7, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 };
afterEach(() => { installCallHandoffs(undefined); vi.useRealTimers(); });

async function liveCall() {
  const state = new MemoryStateStore();
  let now = Date.now();
  const handoffs = new MemoryHandoffStore({ audit: state, now: () => now });
  const published: AgentHandoffPublic[] = [];
  handoffs.subscribe(row => published.push(row));
  installCallHandoffs(handoffs);
  const service = new ControllerApprovals(state, { origin, rpID: 'localhost', enrollmentSecret: 'test-enrollment' }, () => now);
  const auth = new TestAuthenticator();
  const enrolled = await service.registrationOptions('test-enrollment');
  await service.register('test-enrollment', enrolled.challengeId, auth.registration(enrolled.options.challenge));
  const approvals = createApprovalHTTP(() => service, () => origin);
  const gateway = createGateway({ secret: () => 'tool', approvalBridge: createApprovalBridge(state, () => now),
    store: new MemoryGatewayStore([{ ...approvalDemoCall(CALL), agentId: VOICE_AGENT }], state) });
  let seq = 0;
  const tool = async (name: string, fields: Record<string, unknown> = {}) => (await gateway(name, new Request(`${origin}/api/tools/${name}`, {
    method: 'POST', headers: { authorization: 'Bearer tool', 'Content-Type': 'application/json' },
    body: JSON.stringify({ call_id: CALL, webhook_request_id: `r${++seq}`, ...fields }) }))).json();
  const decide = async (id: string, kind: 'Approve' | 'Deny') => {
    const challenge = await service.decisionOptions(id, { kind });
    return approvals('approval', id, 'decide', new Request(`${origin}/decide`, { method: 'POST',
      headers: { origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId: challenge.challengeId, response: auth.assertion(challenge.options.challenge) }) }));
  };
  return { state, handoffs, published, tool, decide, advance: (ms: number) => { now += ms; } };
}

describe('live call in the office', () => {
  it('keeps the voice agent online for the call and idle after it', async () => {
    vi.useFakeTimers();
    const state = new MemoryStateStore();
    const presence = createVoicePresence(() => state, { pulseMs: 5_000 });
    await presence.start(CALL);
    expect(await state.getAgent(VOICE_AGENT)).toMatchObject({ state: 'on_call', seatId: 'collections' });
    await vi.advanceTimersByTimeAsync(60_000);
    await state.reapExpired(Date.now());
    expect((await state.getAgent(VOICE_AGENT))?.state).toBe('on_call');
    await presence.end(CALL);
    expect((await state.getAgent(VOICE_AGENT))?.state).toBe('idle');
    await presence.end(CALL);
    presence.stop();
  });

  it('publishes one collections -> Dana handoff for a voice escalation and completes it on passkey approval', async () => {
    const call = await liveCall();
    const escalated = await call.tool('propose_plan', sevenInstallments);
    expect(escalated).toMatchObject({ kind: 'ESCALATE', rule_ids: ['MAX_INSTALLMENTS'] });
    expect(await call.state.getAgent(VOICE_AGENT)).toMatchObject({ state: 'walking', targetAnchor: 'Dana_desk' });
    await call.tool('check_approval', { escalation_id: escalated.escalation_id });
    expect(await call.state.getAgent(VOICE_AGENT)).toMatchObject({ state: 'walking', targetAnchor: 'Dana_desk' });
    const [offered, ...others] = await call.handoffs.listPublic();
    expect(others).toEqual([]);
    expect(offered).toMatchObject({ caseDisplayId: '1042', fromRole: 'collections', toRole: 'human', toAgentId: 'human:Dana',
      status: 'offered', decisionRef: escalated.escalation_id, reason: 'Escalated to Dana for passkey approval: MAX_INSTALLMENTS' });

    expect((await call.decide(escalated.escalation_id, 'Approve')).status).toBe(200);
    expect(await call.handoffs.listPublic()).toEqual([expect.objectContaining({ handoffId: offered!.handoffId, status: 'completed' })]);
    expect(call.published.map(row => row.status)).toEqual(['offered', 'completed']);
    expect((await call.state.listAudit()).map(row => row.action)).toEqual(expect.arrayContaining(['agent_handoff_offered', 'agent_handoff_completed']));
    expect(await call.tool('check_approval', { escalation_id: escalated.escalation_id })).toMatchObject({ approval_status: 'approved' });
    expect(await call.state.getAgent(VOICE_AGENT)).toMatchObject({ state: 'on_call' });
    expect(call.published).toHaveLength(2);
  });

  it('sends the folder back on denial', async () => {
    const call = await liveCall();
    const escalated = await call.tool('propose_plan', sevenInstallments);
    expect((await call.decide(escalated.escalation_id, 'Deny')).status).toBe(200);
    expect(await call.handoffs.listPublic()).toEqual([expect.objectContaining({ toRole: 'human', status: 'rejected', errorCode: 'DENIED' })]);
  });
});
