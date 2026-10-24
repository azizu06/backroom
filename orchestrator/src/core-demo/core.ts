import { createHash } from 'node:crypto';
import { evaluate, type Context, type Decision } from '@backroom/policy';
import { MemoryStateStore, SeatWorker, FakeEffects, routeInboxItem, createRouter } from '../index';
import { northfield } from '../payables';
import { askWhy, type WhyAuditEntry } from '../why';
import type { AuditEntry } from '../store';
import { runPreCall, createCallPlanner, fakeCreditCheck, fakeHealthCheck } from '../collections';
import { ControllerApprovals } from '../approvals';
import { TestAuthenticator } from '../approvals/testing/authenticator';
import { createApprovalBridge } from '../../../web/lib/approvals/gateway';
import { createGateway } from '../../../web/lib/gateway/http';
import { MemoryGatewayStore, type GatewayCall, type ToolResult } from '../../../web/lib/gateway/store';
import { FakeDemoBank, type DemoBank } from './bank';
import { PaymentService } from '../payments';
import { authorizedPaymentLink } from '../../../web/lib/payments/authorization';

const NOW = Date.parse('2026-10-24T18:00:00Z');
const callId = 'demo-core-1042';
const secret = 'demo-only-in-process-secret';
const arInvoice = northfield.arInvoices.find(row => row.id === '1042')!;
const seedClient = northfield.clients.find(row => row.id === arInvoice.clientId)!;
const receivable = { principalCents: arInvoice.principalCents, lateFeeCents: arInvoice.lateFeeCents };
const baseCall = (): GatewayCall => ({ callId, agentId: 'collections-demo', invoiceId: '1042', clientId: seedClient.id, contactName: 'Jordan',
  companyName: seedClient.name, amountCents: receivable.principalCents + receivable.lateFeeCents, receivable, currency: 'USD', policyVersion: 1,
  identityConfirmed: false, status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} });
const terms = (installments: number, waive_fee = false) => ({ installments, first_payment_pct: 50,
  duration_days: 30, waive_fee, discount_pct: 0 });
const requireThat: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(`CORE_DEMO: ${message}`);
};
export function verifyChain(entries: AuditEntry[]): boolean {
  let previous = '0'.repeat(64);
  return entries.every(({ hash, ...body }, index) => {
    const valid = body.seq === index + 1 && body.prevHash === previous
      && hash === createHash('sha256').update(JSON.stringify(body)).digest('hex');
    previous = hash; return valid;
  });
}

export async function runCoreDemo(options: { bank?: DemoBank; accountId?: string; bankLabel?: string } = {}) {
  const store = new MemoryStateStore();
  const gatewayStore = new MemoryGatewayStore([baseCall()], store);
  const gateway = createGateway({ secret: () => secret, store: gatewayStore,
    approvalBridge: createApprovalBridge(store, () => NOW) });
  const bank = options.bank ?? new FakeDemoBank();
  const transcript: string[] = ['3D CLOSED; synthetic company/client; scripted call turns (no phone call).'];
  let requestId = 0;
  const tool = async (name: string, args: Record<string, unknown> = {}): Promise<ToolResult> => {
    const response = await gateway(name, new Request(`http://demo.invalid/api/tools/${name}`, {
      method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ call_id: callId, webhook_request_id: `core-turn-${++requestId}`, ...args }),
    }));
    requireThat(response.ok, `gateway ${name} failed (${response.status})`);
    const result = await response.json() as ToolResult;
    transcript.push(`${name}: ${JSON.stringify(result)}`);
    return result;
  };
  const audit = async (action: string, decision: Decision, inputs: Record<string, unknown> = {}) =>
    store.appendAudit({ ts: NOW, actor: 'code', seat: 'collections', action, ruleIds: decision.ruleIds,
      policyVersion: decision.policyVersion, refs: ['1042'], route: 'code', decision: decision.kind, inputs,
      latencyMs: 0, costUsd: 0 });

  await store.registerAgent('collections-demo', 'collections', NOW);
  await store.enqueueTask({ id: 'collect-1042', seatId: 'collections', refs: ['1042'], idempotencyKey: 'ar:1042:1', steps: [] });
  const lease = await store.claimTask('collections-demo', NOW, 12000);
  requireThat(lease, 'collection lease missing');
  await store.insertInvoice({ id: '1042', kind: 'ar', state: 'overdue' });
  // Real #17 pipeline with explicit synthetic CRS/Apify/model transports.
  if (seedClient.type !== 'business' && seedClient.type !== 'consumer') throw new Error('CORE_DEMO: invalid seed client type');
  const context: Context = { client: { ...seedClient, type: seedClient.type, localWeekday: 6, localHour: 11 },
    demoOverride: { visible: true, logged: true }, signals: {} };
  transcript.push('DEMO_OVERRIDE visible + logged: synthetic Saturday call. Pre-call signals: FAKE clear CRS/Apify.');
  await store.appendAudit({ ts: NOW, actor: 'system', seat: 'collections', action: 'fake_pre_call_signals',
    ruleIds: ['DEMO_FIXTURE'], policyVersion: 1, refs: ['1042'], route: 'test_stub',
    inputs: { simulated: true, context }, latencyMs: 0, costUsd: 0 });
  const fixtureRouter = createRouter({ stateStore: store, cloudApiKey: 'test-fixture', cloudModel: 'scripted-fixture',
    now: () => NOW, fetch: async () => Response.json({ choices: [{ message: { content: JSON.stringify({
      confidence: 1, output: { tone: 'neutral', offerOrder: ['pay_in_full', 'installments'],
        plan: { installments: 2, firstPaymentPct: 50, totalDays: 30, waiveFees: false, discountPct: 0 } },
    }) } }], usage: { cost: 0 } }) });
  const preCall = await runPreCall({ clientId: seedClient.id, invoiceId: '1042', testIdentityId: 7,
    company: { name: seedClient.name, website: 'https://example.com' }, context }, {
    credit: fakeCreditCheck({ testIdentityId: 7, ofacStatus: 'clear', activeSignals: [], evidence: [] }),
    health: fakeHealthCheck({ signals: [] }), planner: createCallPlanner({ cloudRoute: fixtureRouter.route }),
    audit: { appendAudit: entry => store.appendAudit(entry.action === 'call_plan'
      ? { ...entry, actor: 'system', route: 'test_stub' } : entry) },
    escalate: async decision => { await store.createEscalation(lease, decision, NOW); }, now: () => NOW,
  });
  requireThat(preCall.status === 'ready', 'merged pre-call pipeline did not prepare the call');
  // Recheck permission at the simulated dial boundary after preparation.
  const permit = evaluate('collections', { type: 'call_client' }, context);
  await audit('canCall', permit, { context });
  requireThat(permit.kind === 'ALLOW', 'call not permitted');
  const envelope = preCall.envelope;
  await audit('compute_envelope', permit, { envelope });
  transcript.push(`canCall: ALLOW; envelope: ${JSON.stringify(envelope)}; call plan: SCRIPTED (no model).`);
  await store.transitionInvoice(lease, '1042', 'overdue', 'in_collection', NOW);
  await store.setAgentState(lease, 'on_call', NOW);
  transcript.push('SCRIPTED AI/business/recording disclosure, then identity confirmation.');
  const identityGuard = await tool('get_invoice_context');
  requireThat(identityGuard.kind === 'DENY' && identityGuard.amount_cents === undefined, 'identity guard failed');
  await tool('verify_identity_result', { result: 'confirmed' });
  await tool('get_invoice_context');
  const denial = await tool('propose_plan', terms(4, true));
  requireThat(denial.kind === 'DENY' && denial.rule_ids instanceof Array && denial.rule_ids.includes('FEES_NON_WAIVABLE'), 'fee waiver not denied');
  // Policy is first-failure: re-propose four installments with fees retained to check that limit.
  const escalation = await tool('propose_plan', terms(4));
  requireThat(escalation.kind === 'ESCALATE' && typeof escalation.escalation_id === 'string', 'four payments not escalated');
  const pending = await tool('check_approval', { escalation_id: escalation.escalation_id });
  requireThat(pending.kind === 'PENDING', 'premature approval');
  const row = await store.getEscalation(escalation.escalation_id);
  requireThat(row?.status === 'pending', 'escalation row missing');
  const targetAnchor = (await store.getAgent('collections-demo'))!.targetAnchor;
  await store.transitionInvoice(lease, '1042', 'in_collection', 'pending_owner', NOW);
  transcript.push(`escalation row=${row.id}; agent target=${targetAnchor}`);
  // Real #20 registration/assertion verification. Software test authenticator replaces Dana's phone.
  const controller = new ControllerApprovals(store,
    { origin: 'http://localhost:3020', rpID: 'localhost', enrollmentSecret: 'demo-only-enrollment' }, () => NOW);
  const authenticator = new TestAuthenticator();
  const registration = await controller.registrationOptions('demo-only-enrollment');
  await controller.register('demo-only-enrollment', registration.challengeId,
    authenticator.registration(registration.options.challenge));
  const challenge = await controller.decisionOptions(row.id, { kind: 'Deny' });
  const controllerRow = await controller.decide(row.id, challenge.challengeId,
    authenticator.assertion(challenge.options.challenge));
  requireThat(controllerRow.status === 'denied' && controllerRow.method === 'passkey', 'passkey denial not stored');
  transcript.push('REAL WebAuthn verification with SOFTWARE TEST authenticator: Dana DENY; no human phone/Face ID tap.');
  const approval = await tool('check_approval', { escalation_id: row.id });
  requireThat(approval.approval_status === 'denied' && !approval.can_confirm, 'controller decision not relayed');
  await store.setAgentTarget(lease, 'collections_desk', NOW);
  const allowed = await tool('propose_plan', terms(2));
  requireThat(allowed.kind === 'ALLOW' && allowed.can_confirm && typeof allowed.plan_id === 'string', 'two payments not authorized');
  await store.transitionInvoice(lease, '1042', 'pending_owner', 'promised', NOW);
  const linkResult = await tool('send_payment_link', { plan_id: allowed.plan_id });
  const link = await gatewayStore.transact(callId, call => call.links.find(link => link.planId === allowed.plan_id));
  requireThat(link && link.amountCents === 247500 && linkResult.amount_cents === link.amountCents, 'link amount differs from allowed plan');
  transcript.push('Pay delivery SIMULATED; real payment service consumes the stored ALLOW link.');
  const payments = new PaymentService({ bank, accountId: options.accountId ?? 'receivables', now: () => NOW,
    lookup: async id => {
      const call = await gatewayStore.findPaymentCall(id);
      return call ? authorizedPaymentLink(call, id) : undefined;
    } });
  const before = await payments.view(link.id);
  const payment = await payments.pay(link.id);
  const reconciled = await payments.reconcile(link.id, store, lease, 'promised');
  requireThat(reconciled.status === 'partially_paid', 'bank feed did not match amount + memo + unique deposit');
  const after = await payments.view(link.id);
  const invoiceState = reconciled.status;
  const balanceBeforeCents = Math.round(before.balance.displayTotal * 100);
  const balanceAfterCents = Math.round(after.balance.displayTotal * 100);
  await store.completeTask(lease, 'done', NOW);
  transcript.push(`${options.bankLabel ?? 'FAKE Nessie transport'}: ${payment.depositId}; ${invoiceState}; ${after.balance.label}: ${balanceBeforeCents} -> ${balanceAfterCents} cents. Account balance=${after.balance.accountBalance}; not settlement.`);
  const entries = await store.listAudit();
  const whyEntries: WhyAuditEntry[] = entries.filter(e => ['DENY', 'ESCALATE'].includes(e.decision ?? '')).map(e => ({
    id: `audit_${e.seq}`, actor: e.actor, seat: e.seat, action: e.action,
    outcome: e.decision === 'DENY' ? 'denied' : 'escalated', policyVersion: e.policyVersion,
    ruleIds: e.ruleIds, evidenceRefs: [...e.refs, e.id],
    inputs: { invoiceId: '1042', requestedInstallments: 4, maxInstallments: 2 },
  }));
  // Explicit no-network mode even if the shell contains a cloud key. askWhy uses real cited code templates.
  const answers = await Promise.all([
    askWhy('Why did invoice 1042 need Dana?', whyEntries, { stateStore: store, apiKey: '' }),
    askWhy('Why was the fee waiver for 1042 denied?', whyEntries, { stateStore: store, apiKey: '' }),
  ]);
  return { preCall, controllerRow, collection: { denial, escalation, targetAnchor, approval, allowed, amountCents: link.amountCents,
    invoiceState, balanceBeforeCents, balanceAfterCents }, answers, entries, whyEntries, chainValid: verifyChain(entries), transcript };
}

/** #22 thin adapter: typed inbox -> real SeatWorker/evaluateStep; no PDF/email extraction model. */
export async function runInboxTrap({ llmOff = false } = {}) {
  const store = new MemoryStateStore();
  if (llmOff) await store.setLlmEnabled(false);
  let modelRequests = 0;
  const forbiddenNetwork: typeof fetch = async () => { modelRequests++; throw new Error('DEMO_NETWORK_FORBIDDEN'); };
  const modelResult = llmOff ? await createRouter({ stateStore: store, fetch: forbiddenNetwork }).route('field_extraction', {}) : undefined;
  const routing = await routeInboxItem({ id: '4471', kind: 'bank_change', subject: 'Pay to our new bank account' }, store,
    { fetch: forbiddenNetwork });
  const effects = new FakeEffects();
  const worker = new SeatWorker({ id: 'payables-demo', seat: routing.seat, store, effects, now: () => NOW });
  await worker.start();
  const change = northfield.bankChanges.find(row => row.id === 'bc-lookalike')!;
  const known = northfield.vendors.find(row => row.id === change.vendorId)!;
  const vendor = { ...known, sourceDomain: change.senderDomain };
  const seedInvoice = northfield.apInvoices.find(row => row.id === change.invoiceId)!;
  const invoice = { id: seedInvoice.id, vendorId: seedInvoice.vendorId, amountCents: seedInvoice.amountCents,
    poMatched: seedInvoice.poMatched, account: seedInvoice.account, lineItems: seedInvoice.lineItems };
  await store.insertInvoice({ id: '4471', kind: 'ap', state: 'extracted' }); // typed fixture replaces extraction
  await store.enqueueTask({ id: 'trap-4471', seatId: routing.seat, refs: ['4471', vendor.sourceDomain, vendor.knownDomain],
    idempotencyKey: '4471-installment-1', steps: [{ kind: 'nessie', action: { type: 'pay_invoice' },
      context: { vendor }, input: { invoice } }] });
  await worker.tick();
  const task = await store.getTask('trap-4471');
  requireThat(task?.escalationId && task.leaseOwner && task.leaseExpiresAt, 'trap did not create escalation');
  await store.transitionInvoice({ ...task, leaseOwner: task.leaseOwner, leaseExpiresAt: task.leaseExpiresAt },
    '4471', 'extracted', 'held', NOW);
  const escalation = await store.getEscalation(task.escalationId);
  const decision = (await store.listAudit()).find(e => e.action === 'pay_invoice');
  // First-failure semantics: separately prove any bank change stays held even after correcting the sender.
  const bankChangeDecision = evaluate('payables', { type: 'pay_invoice', invoice },
    { vendor: { ...vendor, sourceDomain: vendor.knownDomain } });
  await store.appendAudit({ ts: NOW, actor: 'code', seat: 'payables', action: 'bank_change_defense_check',
    ruleIds: bankChangeDecision.ruleIds, decision: bankChangeDecision.kind, policyVersion: bankChangeDecision.policyVersion,
    refs: ['4471'], route: 'code', inputs: { hypothetical: 'sender corrected; bank change still pending', decision: bankChangeDecision }, latencyMs: 0, costUsd: 0 });
  const entries = await store.listAudit();
  const targetAnchor = (await store.getAgent('payables-demo'))?.targetAnchor;
  requireThat(decision?.ruleIds.includes('LOOKALIKE_DOMAIN') && bankChangeDecision.ruleIds.includes('BANK_CHANGE_HOLD')
    && escalation?.status === 'pending' && effects.calls.length === 0 && modelRequests === 0, 'bank-change trap was not held without models');
  return { routing, decision, bankChangeDecision, escalation, targetAnchor, invoiceState: 'held' as const, bankEffects: effects.calls.length,
    modelResult, modelRequests, entries, chainValid: verifyChain(entries) };
}
