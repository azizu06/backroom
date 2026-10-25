import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Context } from '@backroom/policy';
import { Dispatcher } from '../dispatcher';
import { MemoryHandoffStore } from '../handoff-store';
import { MemoryUsageLedger } from '../usage';
import { createRoleRegistry } from '../roles';
import type { CollectionsCase, CollectionsToolDeps } from '../tools/collections';
import { MemoryStateStore } from '../../store';
import { MemoryEmailOutbox } from '../../collections/email';
import { fakeCreditCheck, fakeHealthCheck } from '../../collections/fakes';
import { northfield } from '../../payables';
import { mockRuntime } from './runtime';
import { revealsInvoice } from './conversation';
import type { Trace } from './chain';

export type EmailDispatcherMode = 'consumer' | 'no_consent' | 'opt_out' | 'after_hours' | 'bankruptcy' | 'ofac'
  | 'dispute' | 'closed' | 'no_address' | 'callable' | 'off' | 'cancel' | 'failed' | 'no_port';

/** The frozen C14 case through the production planner registry, Dispatcher and SDK runtime.
 * Caller/model turns and provider dependencies are scripted; the preview is queued by product code. */
export async function runEmailDispatcher(mode: EmailDispatcherMode = 'consumer') {
  const scenarios = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/scenarios/collections.json', import.meta.url)), 'utf8'));
  const scenario = scenarios.find((row: any) => row.id === 'C14');
  const invoice = northfield.arInvoices.find(row => row.id === scenario.invoiceId)!;
  const client = northfield.clients.find(row => row.id === invoice.clientId)!;
  const over = scenario.steps[0].contextOverrides ?? {};
  const policyContext: Context = { client: { type: client.type as 'business' | 'consumer', phoneNumber: client.phoneNumber,
    dnc: client.dnc, consent: client.consent, localWeekday: 2, localHour: 11, ...over.client }, ...('signals' in over && { signals: over.signals }) };
  if (mode === 'after_hours') policyContext.client!.localHour = 22;
  if (mode === 'no_consent') { policyContext.client!.type = 'business'; policyContext.client!.consent = undefined; }
  if (mode === 'opt_out') { policyContext.client!.type = 'business'; policyContext.client!.dnc = true; }
  if (mode === 'callable') policyContext.client!.type = 'business';
  const stop = { bankruptcy: 'bankruptcy', ofac: 'ofacHit', dispute: 'disputed', closed: 'closedBusiness' } as const;
  if (mode in stop) policyContext.signals = { [stop[mode as keyof typeof stop]]: true };
  const state = new MemoryStateStore();
  if (mode === 'off') await state.setLlmEnabled(false);
  const outbox = new MemoryEmailOutbox();
  const store = new MemoryHandoffStore({ audit: state });
  const trace: Trace[] = [];
  const amountCents = invoice.principalCents + invoice.lateFeeCents;
  const current: CollectionsCase = {
    sessionId: 'offline:C14:session', invoice: { amountCents, currency: 'USD', daysPastDue: 40 },
    precall: { clientId: client.id, invoiceId: invoice.id, testIdentityId: 7,
      company: { name: client.name, website: 'https://example.invalid' }, context: policyContext },
    dial: { sessionId: 'offline:C14:session', agentId: 'offline-agent', fromNumberId: 'offline-number', clientId: client.id,
      businessName: 'Northfield Studio', contactName: client.name, invoiceId: invoice.id, callbackNumber: '+12025550100',
      client: { type: 'business', number: client.phoneNumber, timeZone: client.timezone, dnc: client.dnc } },
    ...(mode !== 'no_address' && { emailContact: { address: 'billing@client.example' } }),
  };
  let providerRequests = 0;
  const deps: CollectionsToolDeps = {
    cases: { load: async () => structuredClone(current) },
    voice: { start: async () => { providerRequests++; return { sessionId: current.sessionId, callId: 'offline:C14:call' }; } },
    now: () => Date.parse('2026-10-27T18:00:00Z'),
    ...(mode !== 'no_port' && { emailFollowUp: { outbox } }),
    precall: { credit: fakeCreditCheck({ testIdentityId: 7, ofacStatus: 'clear', activeSignals: [], evidence: [] }),
      health: fakeHealthCheck({ signals: [] }), audit: state, escalate: async () => {},
      planner: { draft: async () => ({ output: { tone: 'neutral', offerOrder: ['pay_in_full'],
        plan: { installments: 1, firstPaymentPct: 100, totalDays: 0, waiveFees: false, discountPct: 0 } },
        route: 'local', model: 'offline', latencyMs: 0, costUsd: 0 }) } },
  };
  const cancelled = new AbortController();
  const runtime = mockRuntime(store, async (_spec, _ctx, invoke) => {
    await invoke('get_invoice_context');
    await invoke('can_call');
    if (mode === 'failed') throw new Error('SCRIPTED_RUNTIME_FAILURE');
    await invoke('run_precall');
    await invoke('start_call');
    if (mode === 'cancel') cancelled.abort('CANCELLED');
  }, (role, tool, output) => trace.push({ role, tool, output }));
  const dispatcher = new Dispatcher({ runtime, store, ledger: new MemoryUsageLedger(), control: state,
    roles: createRoleRegistry({ collectionsPlanner: deps }), runnerId: 'offline:C14' });
  const request = { caseId: `C14:dispatcher:${mode}`, role: 'collections' as const,
    artifactRefs: [`ar_invoice:${invoice.id}`], credentialOwnerId: 'offline', input: {}, signal: cancelled.signal };
  const first = await dispatcher.runCase(request);
  // A second activation on the same invoice/day must use the same trusted outbox and queue no second preview.
  const repeat = mode === 'consumer' ? await dispatcher.runCase({ ...request, caseId: `${request.caseId}:repeat` }) : undefined;
  const audits = await state.listAudit();
  const emailAudits = audits.filter(row => row.action.startsWith('email_followup_'));
  const preview = outbox.sent[0];
  const checks = {
    dispatcherDone: first.status === 'done' && repeat?.status === 'done',
    collectionsRole: first.activations.length === 1 && first.activations[0]!.role === 'collections',
    onePreview: outbox.sent.length === 1 && preview?.label === 'SIMULATED: email preview, not sent',
    dailyDedupe: emailAudits.filter(row => row.action === 'email_followup_queued').length === 1 &&
      emailAudits.filter(row => row.action === 'email_followup_duplicate').length === 1,
    noDial: providerRequests === 0,
    noAmountOrInvoice: !!preview && !revealsInvoice({ speak: preview.body }, amountCents) && !preview.body.includes(invoice.id),
    noLinkBeforeIdentity: !!preview && !preview.linkId && !preview.body.includes('/pay/'),
    disclosure: !!preview && preview.body.includes('AI assistant') && preview.body.includes('Northfield Studio'),
    contactPrivate: !JSON.stringify(trace).includes('billing@client.example') && !JSON.stringify(emailAudits).includes('billing@client.example'),
    auditChain: (await state.verifyAuditChain()).valid,
  };
  return { id: 'C14', mode, match: Object.values(checks).every(Boolean), checks,
    first: { status: first.status, reason: first.reason ?? null, roles: first.activations.map(row => row.role), syntheticCostUsd: first.costUsd },
    repeat: repeat ? { status: repeat.status, reason: repeat.reason ?? null } : null,
    providerRequests, queuedPreviews: outbox.sent.length,
    emailAudits: emailAudits.map(row => ({ action: row.action, decision: row.decision, ruleIds: row.ruleIds, inputs: row.inputs })),
    tools: trace.map(row => `${row.role}.${row.tool}`),
    scope: 'Production createRoleRegistry collectionsPlanner role -> Dispatcher -> ClaudeAgentRuntime with scripted QueryFn. Product runCollectionsPlanner invokes the policy-checked email fallback on trusted case data and a shared MemoryEmailOutbox; a second dispatcher case proves invoice/day dedupe. No manual eval invocation of runEmailFollowUp, no network or live delivery. A host must opt into the planner role and supply its trusted contact/outbox; office/UI binding is not measured.',
  };
}
