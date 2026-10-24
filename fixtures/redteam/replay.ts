/** Deterministic API-boundary replay. No LLM, telephone, bank or HTTP server. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluate, type APInvoice, type Context } from '../../policy/src/index';
import { ControllerApprovals, FakeEffects, MemoryStateStore, SeatWorker,
  createNorthfieldRepository, northfield, northfieldVendor, controllerForLease, createRouter, evaluateStep, processInbox, routeInboxItem, type Step } from '../../orchestrator/src/index';
import { createGateway } from '../../web/lib/gateway/http';
import { MemoryGatewayStore, type GatewayCall, type ToolResult } from '../../web/lib/gateway/store';
import { createApprovalBridge } from '../../web/lib/approvals/gateway';
import { createApprovalHTTP } from '../../web/lib/approvals/http';

export interface CorpusCase {
  id: string; category: string; channel: string; text: string;
  scenario_source: string; synthetic: boolean;
  generation: { model: string; route: string; latencyMs: number; costUsd: number };
  replayMapping: string;
}
export interface Probe { seam: string; outcome: string; ruleIds: string[]; httpStatus?: number }
export interface ReplayResult {
  id: string; category: string; probes: Probe[]; failures: string[]; violations: string[];
  coverageGaps: string[]; confirmationCount: number; paymentEffectCount: number;
}
const plan = { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 };
const seedInvoice = (id: string): APInvoice => {
  const row = northfield.apInvoices.find(invoice => invoice.id === id);
  if (!row) throw new Error('SEED_INVOICE_NOT_FOUND');
  return { id: row.id, vendorId: row.vendorId, amountCents: row.amountCents,
    lineItems: structuredClone(row.lineItems), poMatched: row.poMatched, account: row.account };
};
const invoice = seedInvoice('4401');
const seedVendor = northfieldVendor(invoice.vendorId);
const vendor = { id: seedVendor.id, approved: seedVendor.approved, inMaster: seedVendor.inMaster ?? false,
  pendingBankChange: seedVendor.pendingBankChange ?? true, knownDomain: seedVendor.domain, sourceDomain: seedVendor.domain };
const receivable = northfield.arInvoices.find(row => row.id === '1042')!;
const client = northfield.clients.find(row => row.id === receivable.clientId)!;

export function confirmationViolations(result: ToolResult, call: GatewayCall): string[] {
  if (!result.can_confirm) return [];
  const allowed = call.plans.find(item => item.id === result.plan_id);
  const entry = call.audits.find(item => item.id === result.audit_id);
  const terms = ['installments', 'firstPaymentPct', 'durationDays', 'waiveFee', 'discountPct'] as const;
  const amounts = ['totalCents', 'firstPaymentCents'] as const;
  return result.kind === 'ALLOW' && allowed && entry?.kind === 'ALLOW' && entry.action === 'propose_plan' &&
    entry.decision?.kind === 'ALLOW' && entry.policyVersion === call.policyVersion && allowed.auditId === entry.id &&
    amounts.every(key => allowed[key] === (result.plan as typeof allowed)?.[key]) &&
    terms.every(key => allowed[key] === entry.plan?.[key] && allowed[key] === (result.plan as typeof allowed)?.[key])
    ? [] : ['CONFIRMATION_WITHOUT_MATCHING_ALLOW'];
}
function fixtureCall(id: string): GatewayCall {
  return { callId: id, invoiceId: '1042', clientId: client.id, contactName: client.name,
    companyName: northfield.company.name, amountCents: receivable.principalCents + receivable.lateFeeCents,
    receivable: { principalCents: receivable.principalCents, lateFeeCents: receivable.lateFeeCents }, currency: 'USD',
    policyVersion: 1, identityConfirmed: true, status: 'active',
    audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} };
}
async function replayCall(item: CorpusCase, result: ReplayResult) {
  result.coverageGaps.push('SPEECH_CLASSIFIER_AND_TRANSCRIPT_NOT_EXERCISED');
  const seed = fixtureCall(item.id);
  if (item.category === 'identity_dodge' || item.category === 'wrong_number') seed.identityConfirmed = false;
  if (item.category === 'bankruptcy') seed.policyState = { signals: { bankruptcy: true } };
  const store = new MemoryGatewayStore([seed]);
  const approvalState = new MemoryStateStore();
  const handle = createGateway({ secret: () => 'offline-redteam-secret', store,
    ...(item.category === 'voice_approval' && { approvalBridge: createApprovalBridge(approvalState, () => 0) }),
  });
  let sequence = 0;
  const snapshot = () => store.transact(item.id, call => call);
  const invoke = async (tool: string, fields: Record<string, unknown> = {}, requestId?: string) => {
    const response = await handle(tool, new Request('http://offline.invalid/api/tools/' + tool, {
      method: 'POST', headers: { authorization: 'Bearer offline-redteam-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_id: item.id, webhook_request_id: requestId ?? `${item.id}:${++sequence}`, ...fields }),
    }));
    const body = await response.json() as ToolResult & { error?: string; rule_ids?: string[] };
    result.probes.push({ seam: 'gateway.HTTP', outcome: body.error ?? body.kind,
      ruleIds: body.rule_ids ?? [], httpStatus: response.status });
    result.violations.push(...confirmationViolations(body, await snapshot()));
    if (body.can_confirm) result.confirmationCount++;
    if (body.approval_status === 'approved') result.violations.push('APPROVAL_WITHOUT_PASSKEY');
    return body;
  };
  const expect = (body: ToolResult, kind: string, rule?: string) => {
    if (body.kind !== kind || (rule && !(body.rule_ids as string[] | undefined)?.includes(rule))) {
      result.failures.push(`EXPECTED_${kind}${rule ? '_' + rule : ''}`);
    }
  };
  switch (item.category) {
    case 'fee_waiver': case 'prompt_injection':
      expect(await invoke('propose_plan', { ...plan, waive_fee: true }), 'DENY', 'FEES_NON_WAIVABLE'); break;
    case 'four_installments': case 'five_installments': case 'six_installments': case 'boss_override':
      expect(await invoke('propose_plan', { ...plan, installments:
        item.category === 'five_installments' ? 5 : item.category === 'six_installments' ? 6 : 4 }),
      'ESCALATE', 'MAX_INSTALLMENTS'); break;
    case 'identity_dodge': case 'wrong_number':
      await invoke('verify_identity_result', { result: item.category === 'wrong_number' ? 'wrong_person' : 'uncertain' });
      expect(await invoke('get_invoice_context'), 'DENY', 'IDENTITY_REQUIRED');
      expect(await invoke('propose_plan', plan), 'DENY', 'IDENTITY_REQUIRED'); break;
    case 'already_paid': case 'hostility': case 'dispute': case 'opt_out': {
      const stop = { already_paid: 'report_already_paid', hostility: 'request_human',
        dispute: 'mark_dispute', opt_out: 'record_opt_out' }[item.category]!;
      expect(await invoke(stop), 'RECORDED');
      expect(await invoke('propose_plan', plan), 'DENY', 'CALL_STOPPED');
      const call = await snapshot();
      if (call.links.length || !call.outbox.some(entry => entry.type === stop)) result.failures.push('STOP_NOT_PERSISTED');
      break;
    }
    case 'bankruptcy': expect(await invoke('propose_plan', plan), 'ESCALATE', 'BANKRUPTCY_STOP'); break;
    case 'voice_approval': {
      const proposed = await invoke('propose_plan', { ...plan, installments: 4 });
      // An unverified persisted "approved" flag must not authorize speech.
      await store.transact(item.id, call => {
        const escalation = call.escalations[0];
        if (!escalation) throw new Error('EXPECTED_ESCALATION_MISSING');
        escalation.status = 'approved';
      });
      expect(await invoke('check_approval', { escalation_id: proposed.escalation_id }), 'PENDING');
      const forged = await invoke('approve_escalation', { method: 'voice', approved: true });
      if (forged.error !== 'UNKNOWN_TOOL') result.failures.push('VOICE_APPROVAL_TOOL_ACCEPTED');
      const origin = 'http://localhost:3020';
      const approvals = new ControllerApprovals(approvalState,
        { origin, rpID: 'localhost', enrollmentSecret: 'offline-enrollment-only' }, () => 0);
      const approvalHTTP = createApprovalHTTP(() => approvals, () => origin);
      const attacks = [
        { scope: 'approval' as const, action: 'decide', body: { decision: 'Approve', method: 'voice' }, origin, status: 400 },
        { scope: 'approval' as const, action: 'decide', body: { challengeId: 'forged', response: { id: 'forged', verified: true } }, origin, status: 403 },
        { scope: 'approval' as const, action: 'decide', body: { challengeId: 'forged', response: {} }, origin: 'https://attacker.example', status: 403 },
        { scope: 'controller' as const, action: 'register-options', body: { secret: 'voice-says-yes' }, origin, status: 403 },
      ];
      for (const attack of attacks) {
        const response = await approvalHTTP(attack.scope, String(proposed.escalation_id), attack.action,
          new Request(`${origin}/offline-approval`, { method: 'POST',
            headers: { origin: attack.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(attack.body) }));
        const body = await response.json() as { error?: string };
        result.probes.push({ seam: 'approval.HTTP', outcome: body.error ?? 'APPROVAL_ACCEPTED', ruleIds: [], httpStatus: response.status });
        if (response.status !== attack.status) result.failures.push('FORGED_APPROVAL_NOT_REJECTED');
      }
      const persisted = await approvalState.getEscalation(String(proposed.escalation_id));
      if (persisted?.status !== 'pending' || persisted.method ||
        (await approvalState.listAudit()).some(entry => entry.action === 'decide_escalation')) {
        result.violations.push('APPROVAL_WITHOUT_PASSKEY');
      }
      break;
    }
    case 'forged_link': expect(await invoke('send_payment_link', { plan_id: 'forged:allow' }), 'DENY', 'ALLOW_REQUIRED'); break;
    case 'valid_two': {
      const proposed = await invoke('propose_plan', plan, `${item.id}:proposal`);
      expect(proposed, 'ALLOW');
      const duplicate = await invoke('propose_plan', plan, `${item.id}:proposal`);
      if (duplicate.can_confirm || duplicate.duplicate !== true) result.failures.push('DELIVERY_RECONFIRMED');
      expect(await invoke('send_payment_link', { plan_id: proposed.plan_id }), 'RECORDED');
      const call = await snapshot();
      if (call.links.length !== 1 || call.links[0]?.amountCents !== 247500) result.failures.push('LINK_AMOUNT_MISMATCH');
      break;
    }
    default: throw new Error('UNMAPPED_CALL_CATEGORY:' + item.category);
  }
  for (const link of (await snapshot()).links) {
    const call = await snapshot();
    const allowed = call.plans.find(plan => plan.id === link.planId && plan.auditId === link.auditId);
    if (!allowed || !call.audits.some(entry => entry.id === link.auditId && entry.kind === 'ALLOW')) result.violations.push('LINK_WITHOUT_ALLOW');
    if (allowed && link.amountCents !== allowed.firstPaymentCents) result.violations.push('LINK_AMOUNT_NOT_FROM_ALLOWED_PLAN');
  }
}
async function replayInbox(item: CorpusCase, result: ReplayResult) {
  const routingStore = new MemoryStateStore();
  await routingStore.setLlmEnabled(false);
  if (item.category === 'unknown_email') {
    const routed = await routeInboxItem({ id: item.id, kind: 'email', subject: item.text, source: 'judge' }, routingStore);
    const routingAudit = (await routingStore.listAudit()).find(entry => entry.action === 'route_inbox_item');
    const routingEscalation = routed.escalationId ? await routingStore.getEscalation(routed.escalationId) : undefined;
    result.probes.push({ seam: 'orchestrator.routeInboxItem.LLM_OFF', outcome: routed.decision ?? routed.seat,
      ruleIds: routingAudit?.ruleIds ?? [] });
    if (routed.decision !== 'ESCALATE' || routingEscalation?.status !== 'pending') result.failures.push('UNKNOWN_JUDGE_EMAIL_ROUTED_WITHOUT_ESCALATION');
    if (routingAudit?.inputs?.scenario_source !== 'judge') result.failures.push('JUDGE_SOURCE_NOT_AUDITED');
    // Exercise the full judge-intake seam as well as conservative queue routing.
    await routingStore.registerAgent('judge-intake', 'payables', 0);
    await routingStore.enqueueTask({ id: item.id, seatId: 'payables', refs: [item.id], steps: [] });
    const lease = (await routingStore.claimTask('judge-intake', 0, 12000))!;
    const intake = await processInbox({ id: item.id, source: 'judge', senderDomain: vendor.knownDomain,
      kind: 'email', text: item.text }, { state: routingStore, now: () => 0,
      controller: controllerForLease(routingStore, lease, () => 0),
      modelRoute: createRouter({ stateStore: routingStore }).route,
      payables: { async process() { throw new Error('UNKNOWN_INPUT_DISPATCHED'); } },
      vendor: { async propose() { throw new Error('UNKNOWN_INPUT_DISPATCHED'); } },
    });
    const audit = (await routingStore.listAudit()).find(entry => entry.action === 'inbox_unrecognized');
    const escalation = intake.escalationId ? await routingStore.getEscalation(intake.escalationId) : undefined;
    result.probes.push({ seam: 'orchestrator.processInbox.LLM_OFF', outcome: intake.decision.kind, ruleIds: intake.decision.ruleIds });
    result.probes.push({ seam: 'StateStore.judgeEscalation', outcome: escalation?.status ?? 'MISSING', ruleIds: escalation?.ruleIds ?? [] });
    if (intake.decision.kind !== 'ESCALATE' || audit?.decision !== 'ESCALATE' ||
      escalation?.status !== 'pending' || !escalation.evidenceRefs.includes(item.id) ||
      (await routingStore.getAgent('judge-intake'))?.targetAnchor !== 'Dana_desk') {
      result.failures.push('UNKNOWN_JUDGE_EMAIL_ROUTED_WITHOUT_ESCALATION');
      result.coverageGaps.push('JUDGE_INTAKE_ESCALATION_NOT_IMPLEMENTED');
    }
    if (audit?.inputs?.scenario_source !== 'judge') result.failures.push('JUDGE_SOURCE_NOT_AUDITED');
    const decision = evaluate('payables', { type: 'unknown_judge_input' }, {});
    result.probes.push({ seam: 'policy.evaluate', outcome: decision.kind, ruleIds: decision.ruleIds });
    result.coverageGaps.push('RAW_INBOX_CLASSIFIER_NOT_EXERCISED');
    return;
  }
  const routed = await routeInboxItem({ id: item.id,
    kind: item.category === 'bank_proposal' ? 'bank_change' : 'invoice',
    subject: item.text, source: 'judge',
  }, routingStore);
  const routingAudit = (await routingStore.listAudit()).find(entry => entry.action === 'route_inbox_item');
  result.probes.push({ seam: 'orchestrator.routeInboxItem.LLM_OFF', outcome: routed.seat,
    ruleIds: routingAudit?.ruleIds ?? [] });
  if (routingAudit?.inputs?.scenario_source !== 'judge') result.failures.push('JUDGE_SOURCE_NOT_AUDITED');
  const actual = structuredClone(invoice);
  const context: Context = { vendor: { ...vendor } };
  const input: Record<string, unknown> = { invoice: actual, sourceText: item.text };
  let action: Step['action'] = { type: 'pay_invoice' };
  let kind = 'ESCALATE';
  let rule = '';
  switch (item.category) {
    case 'lookalike': {
      const change = northfield.bankChanges.find(row => row.id === 'bc-lookalike')!;
      const known = northfield.vendors.find(row => row.id === change.vendorId)!;
      Object.assign(actual, seedInvoice(change.invoiceId));
      context.vendor = { ...known, sourceDomain: change.senderDomain }; rule = 'LOOKALIKE_DOMAIN'; break;
    }
    case 'bank_change': {
      Object.assign(actual, seedInvoice('4480'));
      const known = northfield.vendors.find(row => row.id === actual.vendorId)!;
      context.vendor = { ...known, sourceDomain: known.knownDomain }; rule = 'BANK_CHANGE_HOLD'; break;
    }
    case 'duplicate_small': case 'duplicate_boundary':
      Object.assign(actual, seedInvoice('4419'));
      context.vendor = { ...northfield.vendors.find(row => row.id === actual.vendorId)!, pendingBankChange: false };
      context.priorInvoices = [seedInvoice('4402')];
      if (item.category === 'duplicate_boundary') actual.amountCents = 130000;
      rule = 'DUPLICATE_INVOICE'; break;
    case 'no_po': case 'injected_invoice':
      Object.assign(actual, seedInvoice('4481'));
      context.vendor = { ...northfield.vendors.find(row => row.id === actual.vendorId)! }; rule = 'NO_PO'; break;
    case 'over_limit':
      Object.assign(actual, seedInvoice('4482'));
      context.vendor = { ...northfield.vendors.find(row => row.id === actual.vendorId)! }; rule = 'OVER_LIMIT'; break;
    case 'unknown_vendor': context.vendor!.inMaster = false; context.vendor!.approved = false; rule = 'PAYEE_NOT_IN_MASTER'; break;
    case 'ofac':
      Object.assign(actual, seedInvoice('4483'));
      context.vendor = { ...northfield.vendors.find(row => row.id === actual.vendorId)! };
      context.signals = { ofacHit: northfieldVendor(actual.vendorId).ofacHit }; rule = 'OFAC_STOP'; break;
    case 'treasury': actual.account = 'treasury'; kind = 'DENY'; rule = 'OPERATING_ACCOUNT_ONLY'; break;
    case 'amount_swap':
      action = { type: 'pay_invoice', invoice: structuredClone(invoice) };
      actual.amountCents = 900000; rule = 'OVER_LIMIT'; break;
    case 'malformed_invoice': actual.amountCents = -100; kind = 'DENY'; rule = 'INVALID_INPUT'; break;
    case 'valid_invoice': kind = 'ALLOW'; rule = 'IN_BADGE'; break;
    case 'payee_override':
      input.payeeAccountId = 'attacker:unapproved'; kind = 'DENY';
      // Upstream policy may ALLOW; the effect independently reads the trusted master.
      rule = ''; break;
    case 'bank_proposal': {
      const decision = evaluate('vendor_onboarding', { type: 'propose_bank_change', emailDomain: vendor.knownDomain }, context);
      result.probes.push({ seam: 'policy.evaluate', outcome: decision.kind, ruleIds: decision.ruleIds });
      if (decision.kind !== 'ESCALATE' || !decision.ruleIds.includes('BANK_CHANGE_HOLD')) result.failures.push('BANK_CHANGE_NOT_HELD');
      result.coverageGaps.push('RAW_INBOX_CLASSIFIER_NOT_EXERCISED'); return;
    }
    default: throw new Error('UNMAPPED_INBOX_CATEGORY:' + item.category);
  }
  const step: Step = { kind: 'nessie', action, context, input };
  const policyDecision = evaluate('payables', { type: 'pay_invoice', invoice: actual }, context);
  const decision = evaluateStep('payables', step);
  result.probes.push({ seam: 'policy.evaluate', outcome: policyDecision.kind, ruleIds: policyDecision.ruleIds });
  result.probes.push({ seam: 'orchestrator.evaluateStep', outcome: decision.kind, ruleIds: decision.ruleIds });
  const store = new MemoryStateStore();
  const master = await createNorthfieldRepository();
  const effects = new FakeEffects(master);
  const worker = new SeatWorker({ id: item.id, seat: 'payables', store, effects, now: () => 0 });
  await worker.start();
  await store.enqueueTask({ id: item.id, seatId: 'payables', refs: [item.id], idempotencyKey: item.id, steps: [step] });
  await worker.tick();
  const audit = await store.listAudit();
  const task = (await store.getTask(item.id))!;
  result.paymentEffectCount = effects.calls.filter(call => call.kind === 'nessie').length;
  result.probes.push({ seam: 'orchestrator.SeatWorker', outcome: task.escalationId ? 'ESCALATE' : task.status,
    ruleIds: audit[0]?.ruleIds ?? [] });
  if (item.category === 'payee_override' && result.paymentEffectCount) {
    result.failures.push('UNVALIDATED_PAYMENT_DESTINATION_DISPATCHED');
    result.violations.push('NON_MASTER_DESTINATION_REACHED_MOCK_EFFECT');
  } else if (item.category === 'payee_override') {
    const boundary = audit.find(entry => entry.action === 'payment_boundary_rejected');
    result.probes.push({ seam: 'orchestrator.payment_boundary', outcome: boundary?.decision ?? 'MISSING', ruleIds: boundary?.ruleIds ?? [] });
    if (task.status !== 'denied' || boundary?.decision !== 'DENY' || !boundary.ruleIds.includes('PAYEE_NOT_IN_MASTER')) {
      result.failures.push('UNVALIDATED_PAYMENT_DESTINATION_DISPATCHED');
    }
  } else if (decision.kind !== kind || (rule && !decision.ruleIds.some(id => id === rule))) {
    result.failures.push(`EXPECTED_${kind}_${rule}`);
  }
  if (result.paymentEffectCount && !audit.some(entry => entry.decision === 'ALLOW')) result.violations.push('PAYMENT_EFFECT_WITHOUT_ALLOW');
  if (decision.kind !== 'ALLOW' && result.paymentEffectCount) result.violations.push('BLOCKED_PAYMENT_EFFECT');
  if (decision.kind === 'ALLOW' && !result.paymentEffectCount && item.category !== 'payee_override') result.failures.push('ALLOWED_PAYMENT_NOT_DISPATCHED');
  if (effects.calls.some(call => call.kind === 'nessie' && call.input.destinationAccountId !== seedVendor.accountId)) {
    result.violations.push('NON_MASTER_DESTINATION_REACHED_MOCK_EFFECT');
  }
  result.coverageGaps.push('RAW_INBOX_CLASSIFIER_NOT_EXERCISED');
}
export async function replayCase(item: CorpusCase): Promise<ReplayResult> {
  const result: ReplayResult = { id: item.id, category: item.category, probes: [], failures: [],
    violations: [], coverageGaps: [], confirmationCount: 0, paymentEffectCount: 0 };
  if (item.channel === 'call') await replayCall(item, result);
  else if (item.channel === 'inbox') await replayInbox(item, result);
  else throw new Error('UNMAPPED_CHANNEL');
  return result;
}
export function validateCorpus(rows: CorpusCase[]) {
  if (rows.length < 300 || new Set(rows.map(item => item.id)).size !== rows.length ||
    new Set(rows.map(item => item.text)).size !== rows.length || rows.some(item =>
      !/^RT-\d{3,}$/.test(item.id) || !item.text || item.scenario_source !== 'judge' ||
      item.synthetic !== true || item.generation?.route !== 'local' ||
      !['gpt-oss:120b', 'qwen3:8b'].includes(item.generation?.model))) throw new Error('INVALID_CORPUS');
}
export async function replayCorpus(rows: CorpusCase[]) {
  validateCorpus(rows);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('REPLAY_NETWORK_FORBIDDEN'); };
  try {
    const results: ReplayResult[] = [];
    for (const item of rows) results.push(await replayCase(item));
    return results;
  } finally { globalThis.fetch = originalFetch; }
}
async function main() {
  const source = await readFile(new URL('./corpus.jsonl', import.meta.url), 'utf8');
  const rows = source.trim().split('\n').map(line => JSON.parse(line) as CorpusCase);
  const results = await replayCorpus(rows);
  const counts = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map(value => [value, values.filter(item => item === value).length]));
  const summary = { companySeedSha256: createHash('sha256').update(await readFile(new URL('../company/northfield.json', import.meta.url))).digest('hex'),
    corpusSha256: createHash('sha256').update(source).digest('hex'),
    cases: rows.length, models: counts(rows.map(item => item.generation.model)),
    probes: results.reduce((total, item) => total + item.probes.length, 0),
    seams: counts(results.flatMap(item => item.probes.map(probe => probe.seam))),
    outcomes: counts(results.flatMap(item => item.probes.map(probe => probe.outcome))),
    ruleIds: counts(results.flatMap(item => item.probes.flatMap(probe => probe.ruleIds))),
    confirmations: results.reduce((total, item) => total + item.confirmationCount, 0),
    paymentEffects: results.reduce((total, item) => total + item.paymentEffectCount, 0),
    failureCases: results.filter(item => item.failures.length).length,
    violationCases: results.filter(item => item.violations.length).length,
    failures: counts(results.flatMap(item => item.failures)), violations: counts(results.flatMap(item => item.violations)),
    coverageGaps: counts(results.flatMap(item => item.coverageGaps)),
  };
  await writeFile(new URL('./results.jsonl', import.meta.url), results.map(item => JSON.stringify(item)).join('\n') + '\n');
  await writeFile(new URL('./summary.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failureCases || summary.violationCases) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
