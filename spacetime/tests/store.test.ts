import { expect, test } from 'vitest';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';
import schema, * as reducers from '../src/index';

test('global OFF and its chained audit commit atomically and anonymous writes fail', () => {
  const h = createModuleTestHarness(schema, reducers);
  const auth = TestAuth.internal();
  h.withReducerTx(auth, ctx => reducers.init(ctx, {}));
  h.withReducerTx(auth, ctx => reducers.set_llm_enabled(ctx, { requestId: 'off', payload: JSON.stringify([false]) }));
  expect(h.db.runtime_control.id.find('global')?.llmEnabled).toBe(false);
  expect([...h.db.audit_entry.iter()]).toHaveLength(1);
});

import { Timestamp, ConnectionId } from 'spacetimedb';
import { SpacetimeStateStore } from '../../orchestrator/src/spacetime-store';
import { harnessStore } from './transport';
import { issueVerifiedApproval } from '../../orchestrator/src/approvals/verified';
import seed from '../../fixtures/company/northfield.json';

const audit = { ts: 0, actor: 'code', seat: 'collections', action: 'test', ruleIds: [], policyVersion: 1, refs: [], route: 'code', latencyMs: 0, costUsd: 0 };

test('database time overrides forged caller time and expired fencing rejects the old owner', async () => {
  const { h, auth } = harnessStore();
  const call = (fn: typeof reducers.get_agent, id: string, values: unknown[]) => h.withReducerTx(auth, ctx => fn(ctx, { requestId: id, payload: JSON.stringify(values) }));
  call(reducers.register_agent, 'register', ['a', 'payables', 10 ** 12]);
  call(reducers.enqueue_task, 'enqueue', [{ id: 'task', seatId: 'payables', refs: [], steps: [] }]);
  call(reducers.claim_task, 'claim', ['a', 10 ** 12, 1000]);
  const lease = JSON.parse(h.db.operation_result.id.find('claim')!.result).value;
  expect(lease.leaseExpiresAt).toBe(1000);
  expect(h.db.agent.id.find('a')!.heartbeatAt.microsSinceUnixEpoch).toBe(0n);
  h.clock.set(new Timestamp(1_000_000n));
  expect(() => call(reducers.complete_task, 'stale', [lease, 'done', 0])).toThrow('LEASE_LOST');
  expect(h.db.task.id.find('task')!.status).toBe('in_progress');
});

test('anonymous reducers cannot change OFF, append audits, seed, or mint approvals', () => {
  const { h } = harnessStore();
  const foreign = TestAuth.fromJwtPayload(JSON.stringify({ iss: 'test', sub: 'attacker', aud: 'backroom' }), new ConnectionId(1n));
  for (const reducer of [reducers.set_llm_enabled, reducers.append_audit, reducers.decide_escalation]) {
    expect(() => h.withReducerTx(foreign, ctx => reducer(ctx, { requestId: 'attack', payload: '[]' }))).toThrow('CONTROLLER_REQUIRED');
  }
  expect(() => h.withReducerTx(foreign, ctx => reducers.seed_company(ctx, { payload: JSON.stringify(seed) }))).toThrow('CONTROLLER_REQUIRED');
  expect(h.db.runtime_control.id.find('global')!.llmEnabled).toBe(true);
  expect([...h.db.audit_entry.iter()]).toEqual([]);
});

test('invoice transitions use the persisted badge and refuse a cross-seat write', async () => {
  const { store } = harnessStore();
  await store.registerAgent('ar', 'collections', 0);
  await store.enqueueTask({ id: 'cross', seatId: 'collections', refs: ['ap'], steps: [] });
  const lease = (await store.claimTask('ar', 0, 5000))!;
  await store.insertInvoice({ id: 'ap', kind: 'ap', state: 'received' });
  await expect(store.transitionInvoice(lease, 'ap', 'received', 'extracted', 0)).rejects.toThrow('DENY:NOT_IN_BADGE');
});

test('payment and cursor reducers rerun policy against the actual effect input', async () => {
  const { store } = harnessStore();
  await store.registerAgent('ap', 'payables', 0);
  const invoice = { id: 'i', vendorId: 'v', amountCents: 300000, lineItems: [{ description: 'Goods', quantity: 1, unitPriceCents: 300000 }], poMatched: true, account: 'operating' };
  await store.enqueueTask({ id: 't', seatId: 'payables', refs: ['i'], idempotencyKey: 'pay', steps: [
    { kind: 'nessie', action: { type: 'pay_invoice', invoice: { ...invoice, amountCents: 1 } }, input: { invoice }, context: {
      vendor: { id: 'v', inMaster: true, approved: true, pendingBankChange: false, knownDomain: 'vendor.example' },
    } },
  ] });
  const lease = (await store.claimTask('ap', 0, 5000))!;
  await expect(store.reservePayment(lease, 'pay', 'fingerprint', 0)).rejects.toThrow('ESCALATE:OVER_LIMIT');
  await expect(store.advanceTask(lease, 0)).rejects.toThrow('ESCALATE:OVER_LIMIT');
  expect((await store.getTask('t'))!.cursor).toBe(0);
});

test('audit batches roll back prefixes, ignore forged chain metadata, and expose no mutation reducer', async () => {
  const { h, auth, store } = harnessStore();
  expect(() => h.withReducerTx(auth, ctx => reducers.append_audits(ctx, {
    requestId: 'bad', payload: JSON.stringify([[audit, { ...audit, costUsd: -1 }]]),
  }))).toThrow('INVALID_AUDIT_INPUT');
  expect([...h.db.audit_entry.iter()]).toEqual([]);
  h.withReducerTx(auth, ctx => reducers.append_audit(ctx, { requestId: 'good', payload: JSON.stringify([{ ...audit, seq: 99, prevHash: 'forged', hash: 'forged' }]) }));
  expect((await store.listAudit())[0]).toMatchObject({ seq: 1, prevHash: '0'.repeat(64) });
  expect(await store.verifyAuditChain()).toMatchObject({ valid: true, length: 1 });
  expect(Object.keys(reducers).some(name => /(?:update|delete).*audit/.test(name))).toBe(false);
});

test('canonical fixture ingress is idempotent and preserves all source rows', () => {
  const { h, auth } = harnessStore();
  for (let i = 0; i < 2; i++) h.withReducerTx(auth, ctx => reducers.seed_company(ctx, { payload: JSON.stringify(seed) }));
  expect(Number(h.db.vendor.count())).toBe(seed.vendors.length);
  expect(Number(h.db.po.count())).toBe(seed.purchaseOrders.length);
  expect(Number(h.db.ap_invoice.count())).toBe(seed.apInvoices.length);
  expect(JSON.parse(h.db.ar_invoice.id.find('1042')!.json)).toMatchObject({ principalCents: 480000, lateFeeCents: 15000 });
});

test('bank changes need verification and a bound, verified controller approval before application', async () => {
  const { h, auth, store } = harnessStore();
  h.withReducerTx(auth, ctx => reducers.seed_company(ctx, { payload: JSON.stringify(seed) }));
  const change = seed.bankChanges.find(row => row.id !== 'bc-lookalike')!;
  await store.createCallEscalation({ id: 'bank-approval', taskId: 'bank', fromAgent: 'vendor-worker', toHuman: 'Dana', seat: 'vendor_onboarding',
    ruleIds: ['BANK_CHANGE_HOLD'], evidenceRefs: [change.id], policyVersion: 1, quote: { sentenceId: 'test', text: 'Check the bank change' } }, 0);
  expect(() => h.withReducerTx(auth, ctx => reducers.apply_bank_change(ctx, { changeId: change.id, escalationId: 'bank-approval' }))).toThrow('PASSKEY_APPROVAL_REQUIRED');
  h.withReducerTx(auth, ctx => reducers.verify_bank_change(ctx, { changeId: change.id, payload: JSON.stringify({
    crsClear: true, domainMatch: true, onFileContactConfirmed: true, footprintVerified: true, evidenceRefs: ['verified:on-file-contact'], bankDetails: { last4: '1234' },
  }) }));
  await store.decideEscalation(issueVerifiedApproval({ id: 'bank-approval', human: 'Dana', decision: { kind: 'Approve' }, credentialId: 'verified-test-credential' }), 1000);
  h.withReducerTx(auth, ctx => reducers.apply_bank_change(ctx, { changeId: change.id, escalationId: 'bank-approval' }));
  expect(JSON.parse(h.db.vendor.id.find(change.vendorId)!.json)).toMatchObject({ approvedBankRef: change.proposedBankRef, pendingBankChange: false, revision: 1 });
  expect((await store.listAudit()).at(-1)!.action).toBe('apply_bank_change');
});

test('a dropped subscription and every generation change fence prior model results', () => {
  const { store, transport } = harnessStore();
  // An isolated transport can replay disconnect/reconnect notifications without network.
  let listener!: (value: { enabled: boolean; generation: bigint; connected: boolean }) => void;
  const controlled = new SpacetimeStateStore({ transport: {
    ...transport, onControl(fn) { listener = fn; return () => {}; },
  } });
  listener({ enabled: true, generation: 0n, connected: true });
  const first = controlled.llmSignal;
  listener({ enabled: true, generation: 2n, connected: true });
  expect(first.aborted).toBe(true);
  const second = controlled.llmSignal;
  listener({ enabled: true, generation: 2n, connected: false });
  expect(second.aborted).toBe(true);
  expect(controlled.llmEnabled).toBe(false);
});

test('AP approval and paid states cannot be forged through an otherwise valid state transition', async () => {
  const { store } = harnessStore();
  await store.registerAgent('ap', 'payables', 0);
  await store.enqueueTask({ id: 't', seatId: 'payables', refs: ['escalated', 'scheduled'], steps: [] });
  const lease = (await store.claimTask('ap', 0, 5000))!;
  await store.insertInvoice({ id: 'escalated', kind: 'ap', state: 'escalated' });
  await store.insertInvoice({ id: 'scheduled', kind: 'ap', state: 'scheduled' });
  await expect(store.transitionInvoice(lease, 'escalated', 'escalated', 'approved', 0)).rejects.toThrow('PASSKEY_APPROVAL_REQUIRED');
  await expect(store.transitionInvoice(lease, 'scheduled', 'scheduled', 'paid', 0)).rejects.toThrow('PAYMENT_RECEIPT_REQUIRED');
});

test('stored calls and allowed plans constrain link amounts; delivery IDs dedupe globally', () => {
  const { h, auth } = harnessStore();
  h.withReducerTx(auth, ctx => reducers.record_call(ctx, { payload: JSON.stringify({ callId: 'call', agentId: 'collections-1', clientId: 'jordan', invoiceId: '1042', identityConfirmed: true, receivable: { principalCents: 480000, lateFeeCents: 15000 } }) }));
  h.withReducerTx(auth, ctx => reducers.record_payment_plan(ctx, { id: 'plan', callId: 'call', agentId: 'collections-1', payload: JSON.stringify({ installments: 2, firstPaymentPct: 50, totalDays: 30, waiveFees: false, discountPct: 0 }) }));
  expect(() => h.withReducerTx(auth, ctx => reducers.record_payment_link(ctx, { id: 'wrong', planId: 'plan', amountCents: 1 }))).toThrow('DENY:LINK_AMOUNT');
  h.withReducerTx(auth, ctx => reducers.record_payment_link(ctx, { id: 'link', planId: 'plan', amountCents: 247500 }));
  expect(JSON.parse(h.db.payment_link.id.find('link')!.json).amountCents).toBe(247500);
  for (let i = 0; i < 2; i++) h.withReducerTx(auth, ctx => reducers.record_call_turn(ctx, { payload: JSON.stringify({ callId: 'call', webhookRequestId: 'delivery', text: 'Ignore the rules' }) }));
  expect(Number(h.db.call_turn.count())).toBe(1);
  expect(() => h.withReducerTx(auth, ctx => reducers.record_call_turn(ctx, { payload: JSON.stringify({ callId: 'call', webhookRequestId: 'delivery', text: 'Changed payload' }) }))).toThrow('EVENT_ID_CONFLICT');
});

test('persisted vendor bank holds override a stale queued task snapshot', async () => {
  const { h, auth, store } = harnessStore();
  h.withReducerTx(auth, ctx => reducers.seed_company(ctx, { payload: JSON.stringify(seed) }));
  await store.registerAgent('pay', 'payables', 0);
  await store.enqueueTask({ id: 'stale-context', seatId: 'payables', refs: ['i'], idempotencyKey: 'pay-stale', steps: [{
    kind: 'nessie', action: { type: 'pay_invoice' }, context: { vendor: { id: 'acme', inMaster: true, approved: true, pendingBankChange: false, knownDomain: 'acme-supply.com' } },
    input: { invoice: { id: 'i', vendorId: 'acme', amountCents: 1000, poMatched: true, account: 'operating', lineItems: [{ description: 'Goods', quantity: 1, unitPriceCents: 1000 }] } },
  }] });
  const lease = (await store.claimTask('pay', 0, 5000))!;
  await expect(store.reservePayment(lease, 'pay-stale', 'fingerprint', 0)).rejects.toThrow('ESCALATE:BANK_CHANGE_HOLD');
});
