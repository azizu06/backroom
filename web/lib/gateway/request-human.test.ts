import { describe, expect, it } from 'vitest';
import { createGateway } from './http';
import { MemoryGatewayStore, type GatewayCall } from './store';

const call = (): GatewayCall => ({ callId: 'call-c05', invoiceId: '1042', clientId: 'client-02', contactName: 'Jordan', companyName: 'Northfield Studio',
  amountCents: 495000, receivable: { principalCents: 480000, lateFeeCents: 15000 }, currency: 'USD', policyVersion: 1, identityConfirmed: false,
  status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} });

async function setup() {
  const store = new MemoryGatewayStore([call()]);
  const handle = createGateway({ secret: () => 'secret', store });
  const tool = async (name: string, id: string, args: Record<string, unknown> = {}) => {
    const response = await handle(name, new Request(`http://gateway.test/api/tools/${name}`, { method: 'POST',
      headers: { authorization: 'Bearer secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_id: 'call-c05', webhook_request_id: id, ...args }) }));
    return { status: response.status, body: await response.json() };
  };
  const audits = async () => (await store.transact('call-c05', current => structuredClone(current))).audits;
  return { tool, audits };
}

describe('C05 request_human reason', () => {
  it('records HOSTILE_ESCALATE alongside REQUEST_HUMAN for a hostile caller, with the same stop and line', async () => {
    const { tool, audits } = await setup();
    const result = await tool('request_human', 'w1', { reason: 'hostile' });
    expect(result.body).toMatchObject({ kind: 'RECORDED', can_confirm: false, speak: 'I have requested a human to follow up and paused collection.' });
    expect((await audits()).at(-1)).toMatchObject({ action: 'request_human', kind: 'ESCALATE', ruleIds: ['REQUEST_HUMAN', 'HOSTILE_ESCALATE'] });
    expect((await tool('propose_plan', 'w2', { installments: 1, first_payment_pct: 100, duration_days: 0, waive_fee: false, discount_pct: 0 })).body.kind).toBe('DENY');
  });
  it.each([[{ reason: 'asked_for_person' }], [{ reason: 'other' }], [{}]])('keeps a generic REQUEST_HUMAN for %j', async args => {
    const { tool, audits } = await setup();
    expect((await tool('request_human', 'w1', args)).status).toBe(200);
    expect((await audits()).at(-1)?.ruleIds).toEqual(['REQUEST_HUMAN']);
  });
  it('rejects an unknown reason without recording anything', async () => {
    const { tool, audits } = await setup();
    expect((await tool('request_human', 'w1', { reason: 'angry' })).status).toBe(400);
    expect(await audits()).toEqual([]);
  });
});
