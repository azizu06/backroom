/** Offline AP dispatcher + AR tool adapters. Production SDK adapter, scripted query; no live provider transport. */
import { Dispatcher } from '../dispatcher';
import { MemoryHandoffStore } from '../handoff-store';
import { MemoryUsageLedger } from '../usage';
import { createRoleRegistry, auditorCorrections } from '../roles';
import { mockRuntime } from './runtime';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Json, Role, Specialist, ToolContext } from '../contracts';
import { type ExtractionArtifact, type ExtractorDependencies } from '../roles/extractor';
import { createAuditor } from '../roles/auditor';
import { createReconciler } from '../roles/reconciler';
import { createCollectionsPlannerSpecialist } from '../roles/collections';
import { MemoryVendorEvidenceStore, type VendorToolDeps } from '../tools/vendor';
import { ApifyBudget } from '../tools/vendor-apify';
import { MemoryStateStore } from '../../store';
import { createRouter } from '../../router';
import { createNorthfieldRepository, northfield, northfieldInvoice, northfieldSource, PayablesSeat } from '../../payables';
import type { FinanceRepository, InvoiceFields } from '../../payables';

const fixtureRoot = fileURLToPath(new URL('../../../../fixtures/', import.meta.url));
export interface Trace { role: Role; tool: string; output: Json }
export function context(id: string, role: Role, refs: string[]): ToolContext {
  return { activation: { caseId: id, taskId: `task:${id}`, activationId: `${id}:${role}`, role,
    leaseOwner: 'offline-eval', leaseToken: 1, llmGeneration: 1, artifactRefs: refs,
    credentialOwnerId: 'offline-eval', signal: new AbortController().signal }, assertCurrent: async () => {} };
}
export async function call(spec: Specialist, ctx: ToolContext, trace: Trace[], name: string, input: unknown = {}) {
  const tool = spec.tools.find(row => row.name === name);
  if (!tool) throw new Error(`MISSING_TOOL:${spec.role}:${name}`);
  const output = await tool.execute(ctx, tool.input.parse(input));
  trace.push({ role: spec.role, tool: name, output });
  // DomainTool's public Json boundary: reject primitives before callers read result fields.
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error(`INVALID_TOOL_RESULT:${name}`);
  return output;
}
export async function auditCase(store: MemoryStateStore, id: string, refs: string[], trace: Trace[], receiptIds: string[] = []) {
  const ctx = context(id, 'auditor', refs);
  const spec = await createAuditor(ctx, { store, loadCase: async () => ({ refs, correctionCount: 0 }),
    loadReceipt: async receiptId => receiptIds.includes(receiptId) ? { id: receiptId, status: 'completed' } : undefined });
  const read = await call(spec, ctx, trace, 'read_audit');
  const check = await call(spec, ctx, trace, 'verify_chain');
  if (check.decision === 'ALLOW') {
    const entries = read.entries as { id: string }[];
    const citations = entries.map(row => row.id);
    // Bounded factual summary; no language-quality grading is implied by scripted text.
    await call(spec, ctx, trace, 'record_case_summary', {
      summary: `Offline evidence recorded ${citations.map(ref => `[entry:${ref}]`).join(' ')}`, citations,
    });
  }
  return check;
}

export async function runInvoice(id: string, options: { caseId?: string; pendingBankChange?: boolean; senderDomain?: string;
  candidate?: InvoiceFields; repository?: FinanceRepository; state?: MemoryStateStore;
  /** P12: route extraction through the production router with GX10 healthy or cut; records routing audits. */
  gx10?: 'healthy' | 'cut' } = {}) {
  const caseId = options.caseId ?? `ap:${id}`;
  const trace: Trace[] = [];
  const repository = options.repository ?? await createNorthfieldRepository();
  const state = options.state ?? new MemoryStateStore();
  const fields = northfieldInvoice(id);
  const source = { ...northfieldSource(id), ...(options.senderDomain && { senderDomain: options.senderDomain }) };
  const seedInvoice = northfield.apInvoices.find(row => row.id === id)!;
  const vendor = northfield.vendors.find(row => row.id === fields.vendorId)!;
  if (options.pendingBankChange !== undefined) await repository.saveVendor({ ...(await repository.getVendor(fields.vendorId))!,
    pendingBankChange: options.pendingBankChange });
  const controller = { request: async () => `mock-escalation:${caseId}` };
  const text = readFileSync(`${fixtureRoot}${seedInvoice.emailRef}`, 'utf8');
  const intake = { state, controller,
    readItem: async () => ({ ...source, kind: 'invoice' as const, text }), classify: async () => ({ kind: 'invoice' as const }) };

  // Explicit oracle-fed mock: this tests the schema/evidence path, NOT document reading ability.
  let extraction: ExtractionArtifact | undefined;
  const gx10: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
    output: options.candidate ?? fields, confidence: 1,
  }) } }] }), { status: 200 });
  // P12 link cut: every GX10 request fails; the canned Anthropic transport returns the same oracle candidate.
  const cut: typeof fetch = async () => { throw new TypeError('fetch failed'); };
  const cloudBodies: { system: string; messages: unknown }[] = [];
  const router = options.gx10 && createRouter({ stateStore: state, anthropicApiKey: 'offline-eval-not-a-key', anthropicModel: 'claude-sonnet-5-5',
    fetch: async (url, init) => {
      if (!String(url).startsWith('https://api.anthropic.com/')) return options.gx10 === 'cut' ? cut(url, init) : gx10(url, init);
      cloudBodies.push(JSON.parse(String(init?.body)));
      return Response.json({ model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 400 },
        content: [{ type: 'text', text: JSON.stringify({ output: options.candidate ?? fields, confidence: 0.95 }) }] });
    } });
  const extractor: ExtractorDependencies = { readDocument: async () => ({ text }),
    saveExtraction: async (_ctx, artifact) => { extraction = artifact; return `extraction:${caseId}`; },
    fetch: options.gx10 === 'cut' ? cut : gx10, ...(router && { router, audit: state }) };
  const verifier: VendorToolDeps = { loadCase: async () => ({ vendorId: fields.vendorId, kind: 'invoice',
    senderDomain: source.senderDomain, claimedAccountId: fields.bankAccountId }), vendors: repository,
    bankChangeRisk: { check: async () => ({ score: 0, label: 'FAKE: synthetic fraud risk (not checked)' }) },
    publicRecords: async () => ({ bankruptcies: 0, evidenceRef: 'mock:public-records-clear' }),
    health: { check: async () => ({ signals: [{ type: 'website_reachable', value: vendor.footprint.websiteReachable,
      sourceUrl: `https://${vendor.knownDomain}/`, observedAt: northfield.snapshotAt }] }) },
    contact: async () => { throw new Error('OFFLINE_CONTACT_NOT_CONFIGURED'); },
    budget: new ApifyBudget(), evidence: new MemoryVendorEvidenceStore(), now: () => Date.parse(northfield.snapshotAt) };
  const receipts: string[] = [];
  const destinations: string[] = [];
  const seat = new PayablesSeat({ repository, state, controller, paymentRail: 'nessie', bankChangeRisk: verifier.bankChangeRisk,
    nessie: { payInvoice: async payment => { const receipt = `mock-receipt:${caseId}`; receipts.push(receipt);
      destinations.push(payment.destinationAccountId); return { id: receipt, status: 'completed' }; } } });
  const store = new MemoryHandoffStore({ audit: state });
  const ledger = new MemoryUsageLedger();
  const roles = createRoleRegistry({ intake, extractor, vendor: verifier,
    payables: { seat, repository, controller, loadCase: async () => ({ fields: extraction?.fields as unknown as InvoiceFields, source }) },
    auditor: { store: state, loadCase: async () => ({ refs: [source.id, id, caseId],
      correctionCount: auditorCorrections((await store.getCase(caseId))!) }),
      loadReceipt: async receiptId => receipts.includes(receiptId) ? { id: receiptId, status: 'completed' } : undefined },
  });
  let assessment: Record<string, Json> = {}, verdict: Record<string, Json> = {}, result: Record<string, Json> = {};
  const runtime = mockRuntime(store, async (spec, ctx, invoke) => {
    const handoff = (to: Role, refs: string[]) => invoke('handoff', { to, artifactRefs: refs,
      reason: 'Offline scripted evidence handoff', summary: 'Synthetic fixture evidence; code owns the decision.' });
    if (spec.role === 'intake') {
      await invoke('read_inbox_item', { itemRef: source.id });
      await handoff('extractor', [source.id]);
    } else if (spec.role === 'extractor') {
      await invoke('read_document', { documentRef: source.id, chunk: 0 });
      const local = await invoke('local_extract', { documentRef: source.id });
      const validated = await invoke('validate_extraction', { documentRef: source.id, fields: local.fields });
      if (validated.decision !== 'ALLOW') throw new Error('EXTRACTION_FAILED');
      await handoff('vendor', [source.id, String(validated.artifactRef)]);
    } else if (spec.role === 'vendor') {
      await invoke('get_vendor_master');
      await invoke('check_domain', { which: 'sender' });
      await invoke('check_business');
      await invoke('apify_site_check');
      verdict = await invoke('conclude_verification', { outcome: 'proceed', note: 'Fixed offline script; synthetic providers.' });
      if (verdict.decision === 'DENY') verdict = await invoke('conclude_verification', {
        outcome: 'human_review', note: 'Code rejected proceed; retain human review.' });
      if (verdict.decision !== 'ALLOW') throw new Error('VENDOR_NO_VERDICT');
      if (verdict.next === 'payables') await handoff('payables', [String(verdict.verdictRef)]);
    } else if (spec.role === 'payables') {
      assessment = await invoke('evaluate_invoice');
      result = await invoke('request_payment');
      await handoff('auditor', [...ctx.activation.artifactRefs, ...((result.evidenceRefs ?? []) as string[])]);
    } else if (spec.role === 'auditor') {
      await invoke('read_audit');
      const check = await invoke('verify_chain');
      if (check.decision === 'ALLOW') {
        const citations = check.auditIds as string[];
        await invoke('record_case_summary', { summary: `Offline evidence ${citations.map(ref => `[entry:${ref}]`).join(' ')}`, citations });
      }
    }
  }, (role, tool, output) => trace.push({ role, tool, output }));
  const dispatcher = new Dispatcher({ runtime, store, ledger, control: state, roles, runnerId: 'offline-eval' });
  const dispatched = await dispatcher.runCase({ caseId, role: 'intake', artifactRefs: [source.id], credentialOwnerId: 'offline', input: {} });
  const sealed = await verifier.evidence.get(String(verdict.verdictRef));
  const vendorDecision = sealed?.facts.decision as Record<string, Json> | undefined;
  return { id, caseId, vendorDecision, historical: seedInvoice.status === 'paid',
    actual: ['failed', 'paused', 'cancelled'].includes(dispatched.status) ? 'ERROR' as const
      : result.status === 'paid' ? 'ALLOW' as const : 'HOLD' as const,
    routing: { audits: (await state.listAudit()).filter(row => row.action === 'extraction_routed')
      .map(row => ({ route: row.route, ruleIds: row.ruleIds, model: row.inputs?.model, latencyMs: row.latencyMs, costUsd: row.costUsd })),
      cloudRequests: cloudBodies.length,
      cloudTextOnly: cloudBodies.every(body => JSON.stringify(body.messages) === JSON.stringify([{ role: 'user', content: JSON.stringify(text) }])) },
    extraction: extraction?.fields, assessment, vendor: verdict, result, mockDebits: receipts.length, destinations, trace,
    runtime: { status: dispatched.status, reason: dispatched.reason,
      activations: dispatched.activations.map(row => ({ role: row.role, kind: row.kind, reason: row.reason, model: row.model })),
      handoffs: dispatched.handoffs.map(row => ({ from: row.from, to: row.to, status: row.status })),
      syntheticCostUsd: dispatched.costUsd, syntheticLedger: await ledger.usage('offline') } };
}

export async function runReceivable(id: string, caseId = `ar:${id}`) {
  const invoice = northfield.arInvoices.find(row => row.id === id)!;
  const link = northfield.paymentLinks.find(row => row.invoiceId === id);
  const client = northfield.clients.find(row => row.id === invoice.clientId)!;
  const trace: Trace[] = [];
  const state = new MemoryStateStore();
  const now = Date.now(); // Lease APIs use wall time; emitted observations omit timestamps.
  await state.registerAgent('offline-eval', 'collections', now);
  const invoiceState = invoice.status === 'paid' ? 'paid' : 'overdue';
  await state.insertInvoice({ id, kind: 'ar', state: invoiceState });
  await state.enqueueTask({ id: `task:${caseId}`, seatId: 'collections', refs: [id], steps: [], idempotencyKey: `ar:${id}:1` });
  const lease = (await state.claimTask('offline-eval', now, 60000))!;
  const invoiceRef = link?.id ?? `ar_invoice:${id}`;
  const ctx = context(caseId, 'reconciler', [invoiceRef]);
  ctx.activation.taskId = lease.id;
  ctx.activation.leaseOwner = lease.leaseOwner;
  ctx.activation.leaseToken = lease.leaseToken;
  ctx.assertCurrent = async () => { await state.assertLease(lease, Date.now()); };
  const feed = northfield.bankTransactions.filter(row => row.direction === 'credit' && row.matchedRef === null).map(row => ({
    _id: row.id, amount: row.amountCents / 100, description: row.memo, status: 'completed', medium: 'balance',
    transaction_date: row.postedAt.slice(0, 10), ...('paymentLinkRef' in row ? { paymentLinkRef: row.paymentLinkRef } : {}),
  }));
  const expectedMemo = northfield.bankTransactions.find(row => row.memo.includes(`invoice ${id}`))?.memo
    ?? `${client.name} payment invoice ${id}`;
  const reconciler = await createReconciler({ store: state, bank: { listDeposits: async () => feed },
    loadCase: async () => ({ caseId, invoiceRef, invoiceId: id, accountId: 'receivables',
      amountCents: link?.amountCents ?? invoice.principalCents + invoice.lateFeeCents,
      expectedMemo, state: invoiceState, lease, correctionReturns: 0 }) }, ctx);
  await call(reconciler, ctx, trace, 'read_bank_feed');
  await call(reconciler, ctx, trace, 'read_payment_receipts');
  const result = await call(reconciler, ctx, trace, 'request_exact_match');
  const audit = await auditCase(state, caseId, [id, invoiceRef], trace);
  return { id, result, audit, trace };
}

/** Network-forbidden dependencies for the production Collections planner. */
export function collectionsPlannerFixture(id: string, invoiceId: string, overrides: Record<string, any> = {}) {
  const invoice = northfield.arInvoices.find(row => row.id === invoiceId)!;
  const client = northfield.clients.find(row => row.id === invoice.clientId)!;
  const state = new MemoryStateStore();
  const { spec } = createCollectionsPlannerSpecialist({
    cases: { load: async () => ({ sessionId: `mock:${id}`, invoice: { amountCents: invoice.principalCents + invoice.lateFeeCents,
      currency: 'USD', daysPastDue: 30 }, precall: { clientId: client.id, invoiceId, testIdentityId: 0,
      company: { name: client.name, website: `https://${client.id}.invalid/` }, context: { ...overrides,
        client: { ...client, localWeekday: 2, localHour: 11, ...overrides.client } } },
      dial: { sessionId: `mock:${id}`, agentId: 'offline', fromNumberId: 'offline', clientId: client.id,
        businessName: 'Synthetic Northfield', contactName: 'Synthetic', invoiceId, callbackNumber: '+15555550100',
        client: { type: 'business', number: '+15555550100', timeZone: 'America/Los_Angeles', dnc: false } } }) },
    voice: { start: async () => { throw new Error('OFFLINE_DIAL_FORBIDDEN'); } },
    precall: { audit: state, escalate: async () => {},
      credit: { check: async () => { throw new Error('OFFLINE_CREDIT_FORBIDDEN'); } },
      health: { check: async () => { throw new Error('OFFLINE_HEALTH_FORBIDDEN'); } },
      planner: { draft: async () => { throw new Error('OFFLINE_MODEL_FORBIDDEN'); } } },
  });
  return { spec, state };
}

/** Only the pre-call permit seam is measured here. Scenario speech is exercised by the legacy harness. */
export async function runCollectionsPermit(id: string, invoiceId: string, overrides: Record<string, any> = {}) {
  const trace: Trace[] = [];
  const ctx = context(id, 'collections', [`ar_invoice:${invoiceId}`]);
  const { spec } = collectionsPlannerFixture(id, invoiceId, overrides);
  await call(spec, ctx, trace, 'get_invoice_context');
  const result = await call(spec, ctx, trace, 'can_call');
  return { id, result, trace };
}
