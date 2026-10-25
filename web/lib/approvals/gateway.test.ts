import { describe, expect, it } from 'vitest';
import { MemoryStateStore } from '@backroom/orchestrator';
import { createApprovalBridge } from './gateway';
import { inboxIds } from './inbox';
import { createGateway } from '../gateway/http';
import { MemoryGatewayStore, type GatewayCall } from '../gateway/store';

const call = (callId: string): GatewayCall => ({ callId, invoiceId: '1042', clientId: 'client-02', contactName: 'Jordan', companyName: 'Northfield Studio',
  amountCents: 495000, receivable: { principalCents: 480000, lateFeeCents: 15000 }, currency: 'USD', policyVersion: 1, identityConfirmed: false,
  status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} });

async function setup(callId: string) {
  const state = new MemoryStateStore();
  const handle = createGateway({ secret: () => 'secret', store: new MemoryGatewayStore([call(callId)]), approvalBridge: createApprovalBridge(state) });
  const tool = async (name: string, id: string, args = {}) => (await handle(name, new Request(`http://gateway.test/api/tools/${name}`, {
    method: 'POST', headers: { authorization: 'Bearer secret', 'Content-Type': 'application/json' },
    body: JSON.stringify({ call_id: callId, webhook_request_id: id, ...args }) }))).json();
  return { state, tool };
}

describe('C09 callback owed to Dana', () => {
  it('request_human creates one pending review row for the policy human, with no plan or amount', async () => {
    const { state, tool } = await setup('call-c09');
    expect(await tool('request_human', 'w1')).toMatchObject({ kind: 'RECORDED' });
    await tool('request_human', 'w2');
    const row = await state.getEscalation('callback:call-c09');
    expect(row).toMatchObject({ toHuman: (await state.getPolicy()).toHuman, ruleIds: ['REQUEST_HUMAN'], status: 'pending',
      callId: 'call-c09', invoiceId: '1042', quote: { sentenceId: 'NF-001' } });
    expect(row).not.toHaveProperty('amountCents');
    expect(row).not.toHaveProperty('requestedTerms');
    expect(inboxIds()).toContain('callback:call-c09');
    expect((await state.listAudit()).filter(entry => entry.action === 'create_escalation' && entry.refs[0] === 'callback:call-c09')).toHaveLength(1);
  });
  it('other recorded tools create no callback', async () => {
    const { state, tool } = await setup('call-other');
    await tool('verify_identity_result', 'w1', { result: 'confirmed' });
    expect(await state.getEscalation('callback:call-other')).toBeUndefined();
  });
});
