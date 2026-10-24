/** AR items through the production Dispatcher after a scripted voice conversation on the real tool gateway.
 * The persona's lines are data; the scripted voice agent only chooses which gateway tool to call. */
import { Dispatcher, type CaseResult } from '../dispatcher';
import { MemoryHandoffStore } from '../handoff-store';
import { MemoryUsageLedger } from '../usage';
import { auditorCorrections, correctionReturns, createRoleRegistry } from '../roles';
import { runCollectionsPlanner, type CallRecordView } from '../roles/collections';
import type { Json } from '../contracts';
import { mockRuntime } from './runtime';
import { context, type Trace } from './chain';
import { MemoryStateStore } from '../../store';
import { northfield } from '../../payables';
import { fakeCreditCheck, fakeHealthCheck } from '../../collections/fakes';
import { createGateway } from '../../../../web/lib/gateway/http';
import { MemoryGatewayStore, type GatewayCall } from '../../../../web/lib/gateway/store';

export const CONVERSATIONS = ['promise', 'dispute', 'already_paid_matched', 'already_paid_unmatched', 'wrong_number', 'opt_out',
  'hostile', 'human_request', 'voicemail'] as const;
export type Conversation = typeof CONVERSATIONS[number];
type Turn = { caller: string; tool?: string; args?: Record<string, unknown> };
const confirm: Turn[] = [
  { caller: 'Hello?', tool: 'verify_identity_result', args: { result: 'confirmed' } },
  { caller: 'Yes, this is the right person.', tool: 'get_invoice_context' },
];
/** Frozen scenario id, invoice and the voice agent's tool choices for each caller line. */
const SCRIPTS: Record<Conversation, { scenarioId: string; invoiceId: string; turns: Turn[] }> = {
  promise: { scenarioId: 'C02', invoiceId: '1042', turns: [...confirm,
    { caller: 'Can I pay half now and the rest in thirty days?', tool: 'propose_plan',
      args: { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 } },
    { caller: 'Okay, send me the link.', tool: 'send_payment_link' }] },
  dispute: { scenarioId: 'C10', invoiceId: '1042', turns: [...confirm,
    { caller: 'We never received that work. I dispute this invoice.', tool: 'mark_dispute' },
    { caller: 'Fine, what if I paid half?', tool: 'propose_plan',
      args: { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 } }] },
  already_paid_matched: { scenarioId: 'C06', invoiceId: '1043', turns: [...confirm,
    { caller: 'We already paid that on the twentieth.', tool: 'report_already_paid' }] },
  already_paid_unmatched: { scenarioId: 'C07', invoiceId: '1042', turns: [...confirm,
    { caller: 'That is paid, we sent it last week.', tool: 'report_already_paid' }] },
  wrong_number: { scenarioId: 'C08', invoiceId: '1042', turns: [
    { caller: 'Who? There is nobody here by that name.', tool: 'verify_identity_result', args: { result: 'wrong_person' } },
    { caller: 'What is this about? How much do they owe?', tool: 'get_invoice_context' }] },
  hostile: { scenarioId: 'C05', invoiceId: '1042', turns: [...confirm,
    { caller: 'You people are thieves. I am not paying a cent, stop harassing me.' },
    { caller: 'I said I am done talking to a robot.', tool: 'request_human' }] },
  human_request: { scenarioId: 'C09', invoiceId: '1042', turns: [...confirm,
    { caller: 'I would rather talk to Dana directly, please have her call me.', tool: 'request_human' }] },
  // Voicemail: nobody confirms identity; the agent leaves a generic callback and must not reveal the invoice.
  voicemail: { scenarioId: 'C21', invoiceId: '1042', turns: [
    { caller: '(voicemail greeting) Please leave a message after the tone.' },
    { caller: '(beep)', tool: 'get_invoice_context' }] },
  opt_out: { scenarioId: 'C12', invoiceId: '1042', turns: [...confirm,
    { caller: 'Stop calling this number. Take us off your list.', tool: 'record_opt_out' },
    { caller: 'Actually, what was the amount again?', tool: 'propose_plan',
      args: { installments: 1, first_payment_pct: 100, duration_days: 0, waive_fee: false, discount_pct: 0 } }] },
};
/** Integration outcomes from the frozen key's wording, checked against code-owned state only. */
const EXPECTED: Record<Conversation, { caseStatus: CaseResult['status']; roles: string[]; cleared: boolean; callStatus: GatewayCall['status'] }> = {
  promise: { caseStatus: 'done', roles: ['collections', 'reconciler', 'collections', 'reconciler', 'collections', 'reconciler', 'auditor'], cleared: false, callStatus: 'active' },
  dispute: { caseStatus: 'held', roles: ['collections'], cleared: false, callStatus: 'disputed' },
  already_paid_matched: { caseStatus: 'done', roles: ['collections', 'reconciler', 'auditor'], cleared: true, callStatus: 'already_paid' },
  already_paid_unmatched: { caseStatus: 'done', roles: ['collections', 'reconciler', 'collections', 'reconciler', 'collections', 'reconciler', 'auditor'], cleared: false, callStatus: 'already_paid' },
  wrong_number: { caseStatus: 'held', roles: ['collections'], cleared: false, callStatus: 'human_requested' },
  opt_out: { caseStatus: 'done', roles: ['collections'], cleared: false, callStatus: 'opted_out' },
  hostile: { caseStatus: 'held', roles: ['collections'], cleared: false, callStatus: 'human_requested' },
  human_request: { caseStatus: 'held', roles: ['collections'], cleared: false, callStatus: 'human_requested' },
  voicemail: { caseStatus: 'held', roles: ['collections'], cleared: false, callStatus: 'active' },
};

/** `pairing: false` reproduces the pre-fix host: no declared activation pairing for the reconciler. */
export async function runConversation(name: Conversation, options: { pairing?: boolean } = {}) {
  const { scenarioId, invoiceId, turns } = SCRIPTS[name];
  const invoice = northfield.arInvoices.find(row => row.id === invoiceId)!;
  const client = northfield.clients.find(row => row.id === invoice.clientId)!;
  const caseId = `ar-call:${scenarioId}`;
  const callId = `call-${scenarioId}`, sessionId = `sess-${scenarioId}`;
  const amountCents = invoice.principalCents + invoice.lateFeeCents;
  const state = new MemoryStateStore();
  const trace: Trace[] = [];

  // 1. Planner: production specialist + runtime with offline pre-call fakes; the dial is a mock CallStarter.
  const gateway = new MemoryGatewayStore([]);
  const precallContext = async () => ({ client: { type: client.type as 'business', phoneNumber: client.phoneNumber,
    dnc: client.dnc || await gateway.clientStopped(client.id), localWeekday: 2, localHour: 11, consent: client.consent } });
  const loadCase = async () => ({ sessionId, invoice: { amountCents, currency: 'USD', daysPastDue: 40 },
      precall: { clientId: client.id, invoiceId, testIdentityId: 7, company: { name: client.name, website: 'https://example.invalid' }, context: await precallContext() },
      dial: { sessionId, agentId: 'offline-agent', fromNumberId: 'offline-number', clientId: client.id, businessName: 'Northfield Studio',
        contactName: client.name, invoiceId, callbackNumber: '+12025550100', client: { type: 'business' as const, number: client.phoneNumber, timeZone: client.timezone, dnc: client.dnc } } });
  let dialCount = 0;
  const plannerDeps = (dials: string[]) => ({
    cases: { load: loadCase },
    voice: { start: async () => {
      const id = dialCount++ ? `${callId}-redial-${dialCount - 1}` : callId; // a fresh gateway record per dial
      dials.push(id);
      await gateway.registerCall({ callId: id, invoiceId, clientId: client.id, contactName: client.name, companyName: 'Northfield Studio', amountCents,
        receivable: { principalCents: invoice.principalCents, lateFeeCents: invoice.lateFeeCents }, currency: 'USD', policyVersion: 1,
        identityConfirmed: false, status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} });
      return { sessionId, callId: id };
    } },
    precall: { credit: fakeCreditCheck({ testIdentityId: 7, ofacStatus: 'clear', activeSignals: [], evidence: [] }), health: fakeHealthCheck({ signals: [] }),
      planner: { draft: async () => ({ output: { tone: 'neutral' as const, offerOrder: ['pay_in_full' as const],
        plan: { installments: 1, firstPaymentPct: 100, totalDays: 0, waiveFees: false, discountPct: 0 } }, route: 'local' as const, model: 'offline', latencyMs: 0, costUsd: 0 }) },
      audit: state, escalate: async () => {} },
  });
  const planStore = new MemoryHandoffStore({ audit: state });
  const plan = async (label: string, dials: string[]) => runCollectionsPlanner(mockRuntime(planStore, async (_spec, _ctx, call) => {
    await call('get_invoice_context');
    const permit = await call('can_call');
    if (permit.decision !== 'ALLOW') return;
    const ready = await call('run_precall');
    if (ready.status === 'ready') await call('start_call');
  }, (role, tool, output) => trace.push({ role, tool: `${label}.${tool}`, output })),
  context(`${caseId}:${label}`, 'collections', [`ar_invoice:${invoiceId}`]), plannerDeps(dials));
  const dials: string[] = [];
  const planned = await plan('planner', dials);

  // 2. Scripted conversation against the real gateway handler and store.
  const handle = createGateway({ secret: () => 'eval-offline-secret', store: gateway });
  const transcript: { caller: string; tool?: string; result?: Record<string, Json> }[] = [];
  let planId: string | undefined;
  for (const [index, turn] of turns.entries()) {
    if (!turn.tool) { transcript.push({ caller: turn.caller }); continue; }
    const args = turn.tool === 'send_payment_link' ? { plan_id: planId } : turn.args ?? {};
    const response = await handle(turn.tool, new Request(`http://offline.invalid/api/tools/${turn.tool}`, {
      method: 'POST', headers: { authorization: 'Bearer eval-offline-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_id: callId, webhook_request_id: `${callId}:${index}`, ...args }) }));
    const result = await response.json() as Record<string, Json>;
    if (typeof result.plan_id === 'string') planId = result.plan_id;
    transcript.push({ caller: turn.caller, tool: turn.tool, result });
  }
  const call = await gateway.transact(callId, current => structuredClone(current));

  // 3. Post-call through the production Dispatcher: collections -> reconciler -> auditor.
  const now = Date.now();
  await state.registerAgent('collections-host', 'collections', now);
  await state.insertInvoice({ id: invoiceId, kind: 'ar', state: 'overdue' });
  await state.enqueueTask({ id: `task:${caseId}`, seatId: 'collections', refs: [invoiceId], steps: [], idempotencyKey: `ar:${invoiceId}:1` });
  const lease = (await state.claimTask('collections-host', now, 120000))!;
  const store = new MemoryHandoffStore({ audit: state });
  const callRef = `${caseId}:call:${callId}`;
  const feed = northfield.bankTransactions.filter(row => row.direction === 'credit' && row.matchedRef === null).map(row => ({
    _id: row.id, amount: row.amountCents / 100, description: row.memo, status: 'completed', medium: 'balance',
    transaction_date: row.postedAt.slice(0, 10), ...('paymentLinkRef' in row ? { paymentLinkRef: row.paymentLinkRef } : {}) }));
  // Trusted ledger memo, as in runReceivable; never the caller's words.
  const expectedMemo = northfield.bankTransactions.find(row => row.memo.includes(`invoice ${invoiceId}`))?.memo ?? `${client.name} payment invoice ${invoiceId}`;
  const view = (row: GatewayCall): CallRecordView => ({ callId: row.callId, status: row.status, plans: row.plans,
    escalations: row.escalations, links: row.links });
  const roles = createRoleRegistry({
    collections: { cases: { load: loadCase }, audit: state,
      outcomes: { read: async id => id === sessionId ? view(await gateway.transact(callId, current => structuredClone(current))) : undefined } },
    reconciler: { store: state, bank: { listDeposits: async () => feed as never },
      loadCase: async ctx => {
        const row = (await store.getCase(ctx.activation.caseId))!;
        // Host-declared pairing from the handoff store's own record, never from the model.
        const handed = row.activations.find(a => a.role === 'reconciler' && a.status === 'active')?.activationId;
        return { caseId, invoiceRef: callRef, invoiceId, accountId: 'receivables', amountCents,
          expectedMemo, state: 'overdue', lease,
          correctionReturns: correctionReturns(row, 'reconciler', 'collections'), activationId: options.pairing === false ? undefined : handed };
      } },
    auditor: { store: state, loadCase: async () => ({ refs: [invoiceId, callRef, caseId], correctionCount: auditorCorrections((await store.getCase(caseId))!) }) },
  });
  const runtime = mockRuntime(store, async (spec, ctx, invoke) => {
    const handoff = (to: string, refs: string[], summary: string) => invoke('handoff', { to, artifactRefs: refs, reason: 'Offline scripted post-call handoff', summary });
    if (spec.role === 'collections') {
      const outcome = await invoke('get_call_outcome');
      await handoff('reconciler', outcome.allowedRefs as string[], `Call outcome ${String(outcome.outcome)}; verify bank evidence before any change.`);
    } else if (spec.role === 'reconciler') {
      await invoke('read_bank_feed');
      const match = await invoke('request_exact_match');
      await handoff(String(match.next), (match.artifactRefs as string[]) ?? [callRef], `Code result ${String(match.status)} ${String(match.ruleId ?? '')}`.trim());
    } else if (spec.role === 'auditor') {
      await invoke('read_audit');
      const check = await invoke('verify_chain');
      if (check.decision === 'ALLOW') {
        const citations = check.auditIds as string[];
        await invoke('record_case_summary', { summary: `Offline AR evidence ${citations.map(id => `[entry:${id}]`).join(' ')}`, citations });
      }
    }
  }, (role, tool, output) => trace.push({ role, tool, output }));
  const dispatched = await new Dispatcher({ runtime, store, ledger: new MemoryUsageLedger(), control: state, roles, runnerId: 'offline-ar' })
    .runCase({ caseId, role: 'collections', artifactRefs: [`ar_invoice:${invoiceId}`], credentialOwnerId: 'offline', input: {} });

  // 4. Opt-out persists before the next call: the same host composes the next pre-call from gateway state.
  const redials: string[] = [];
  // Stops persist before the next call; a voicemail does not stop future calls.
  const nextCall = ['opt_out', 'hostile', 'human_request', 'voicemail'].includes(name) ? await plan('next-call', redials) : undefined;
  const nextPermit = trace.find(row => row.tool === 'next-call.can_call')?.output as Record<string, Json> | undefined;

  // The reconciler's code-owned receipt is the only thing that clears an AR invoice.
  const receipt = await state.getPayment(`ar:${invoiceId}:1`);
  const cleared = receipt !== undefined;
  const audits = await state.listAudit();
  const leaked = transcript.some(row => row.tool === 'get_invoice_context' && row.result?.kind === 'DENY' && JSON.stringify(row.result).includes(String(amountCents)));
  const roleOrder = dispatched.activations.map(row => row.role);
  const expected = EXPECTED[name];
  const reconRules = audits.filter(row => row.action === 'agent_reconciliation').map(row => row.ruleIds[0]);
  const checks = {
    dialedOnce: planned.kind === 'started' && dials.length === 1,
    callStatus: call.status === expected.callStatus,
    caseStatus: dispatched.status === expected.caseStatus,
    roles: JSON.stringify(roleOrder) === JSON.stringify(expected.roles),
    cleared: cleared === expected.cleared,
    noLeakBeforeIdentity: !leaked,
    auditChain: (await state.verifyAuditChain()).valid,
    ...(name === 'promise' && { planPersisted: call.plans.length === 1 && call.links.length === 1, notClearedWithoutDeposit: reconRules.every(rule => rule !== 'RECON_EXACT') }),
    ...(name === 'dispute' && { noPlanAfterDispute: call.plans.length === 0 && transcript.at(-1)?.result?.kind === 'DENY' }),
    ...((name === 'hostile' || name === 'human_request') && { noOfferAfterStop: call.plans.length === 0 && call.links.length === 0,
      humanHoldRecorded: audits.some(row => row.action === 'collections_postcall_terminal' && row.inputs?.outcome === 'human_requested'),
      nextCallRefused: nextCall?.kind === 'not_started' && redials.length === 0 && nextPermit?.decision === 'DENY' }),
    ...(name === 'voicemail' && { noDetailsWithoutIdentity: transcript.at(-1)?.result?.kind === 'DENY' && !JSON.stringify(transcript.at(-1)?.result).includes(String(amountCents)),
      nextCallAllowed: nextCall?.kind === 'started' && redials.length === 1 }),
    ...(name === 'opt_out' && { noOfferAfterOptOut: call.plans.length === 0, nextCallRefused: nextCall?.kind === 'not_started' && redials.length === 0
      && nextPermit?.decision === 'DENY' && JSON.stringify(nextPermit?.ruleIds) === JSON.stringify(['DNC']) }),
    ...(name === 'wrong_number' && { identityDenied: transcript.at(-1)?.result?.kind === 'DENY' && JSON.stringify(transcript.at(-1)?.result?.rule_ids ?? []).includes('IDENTITY_REQUIRED') }),
    ...(name === 'already_paid_unmatched' && { claimNotCleared: reconRules.includes('RECON_UNMATCHED') }),
  };
  return { id: name, scenarioId, invoiceId, match: Object.values(checks).every(Boolean), checks,
    callStatus: call.status, caseStatus: dispatched.status, reason: dispatched.reason ?? null, roles: roleOrder, cleared, reconRules,
    gatewayTools: transcript.filter(row => row.tool).map(row => `${row.tool}:${String(row.result?.kind ?? row.result?.error)}`),
    tools: trace.map(row => `${row.role}.${row.tool}`),
    scope: 'Production collections planner (mock CallStarter), real tool gateway handler/store, production Dispatcher + ClaudeAgentRuntime with scripted QueryFn for post-call, reconciler and auditor. Scripted caller lines and voice-agent tool choices; no Cartesia, phone, model or bank network.' };
}
