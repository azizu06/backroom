import { z } from 'zod';
import { MemoryStateStore } from '../store';
import { PayablesSeat } from '../payables';
import { createNorthfieldRepository, northfieldInvoice, northfieldSource } from '../payables/northfield';
import type { DomainTool, Json, Role, Specialist } from './contracts';
import type { CaseRequest } from './dispatcher';
import type { ScriptStep } from './mock-query';
import { createRoleRegistry, type RoleRegistry } from './roles';
import type { CallRecordView } from './roles/collections';
import type { CollectionsCase } from './tools/collections';
import { ApifyBudget } from './tools/vendor-apify';
import { MemoryVendorEvidenceStore } from './tools/vendor';

/** Synthetic demo team: the merged role modules (vendor, payables, collections) on
 * network-free Northfield fixtures, plus stand-ins for roles whose workers have not
 * landed yet (intake, extractor, reconciler, auditor). A merged role replaces its stub
 * by being added to `createRoleRegistry`. All data is synthetic; no bank, call or Apify. */
export const AP_INVOICE = '4401';
export const DEMO_CASES = (owner = 'aziz'): CaseRequest[] => [
  { caseId: `ap-${AP_INVOICE}`, role: 'intake', artifactRefs: [`inbox:${AP_INVOICE}`], credentialOwnerId: owner,
    input: { inboxItem: `inbox:${AP_INVOICE}`, note: 'Synthetic vendor invoice email from Papertrail Print Co' } },
  { caseId: 'ar-1042', role: 'collections', artifactRefs: [], credentialOwnerId: owner,
    input: { note: 'Collection call for invoice 1042 has ended' } },
];

const stub = <I>(name: string, description: string, input: z.ZodType<I>, execute: (input: I, caseId: string) => Json): DomainTool<I, Json> =>
  ({ name, description, input, async execute(ctx, value) { await ctx.assertCurrent(); const out = execute(value, ctx.activation.caseId); await ctx.assertCurrent(); return out; } });
const none = z.object({}).strict();
const spec = (role: Role, allowedNext: Role[], prompt: string, tools: DomainTool<any, Json>[]): Specialist =>
  ({ role, model: 'claude-haiku-5-5', allowedNext, prompt, tools });

/** Stand-ins: same contract as a real role, deliberately tiny tools. */
export const STAND_INS: Partial<Record<Role, Specialist>> = {
  intake: spec('intake', ['extractor'], 'Classify the inbox item with read_inbox_item. Vendor invoices go to extractor with the inbox ref.', [
    stub('read_inbox_item', 'Read safe metadata for this case\'s inbox item', none, () =>
      ({ kind: 'invoice', senderDomain: northfieldSource(AP_INVOICE).senderDomain, artifactRef: `inbox:${AP_INVOICE}` })),
  ]),
  extractor: spec('extractor', ['vendor', 'payables', 'intake'], 'Extract invoice facts with read_document. Hand to vendor for verification, citing the extraction ref.', [
    stub('read_document', 'Read and validate the invoice document fields', none, () => {
      const f = northfieldInvoice(AP_INVOICE);
      return { invoiceId: f.invoiceId, vendorId: f.vendorId, amountCents: f.amountCents, poId: f.poId ?? null, artifactRef: `extraction:${AP_INVOICE}` };
    }),
  ]),
  reconciler: spec('reconciler', ['auditor', 'collections'], 'Check the already-paid claim with match_payment. Exact matches go to auditor citing the match ref; missing evidence goes back to collections.', [
    stub('match_payment', 'Code-owned exact match of the claimed payment against the bank feed', none, (_, caseId) => ({ matched: true, artifactRef: `${caseId}:match` })),
  ]),
  auditor: spec('auditor', ['intake', 'extractor', 'vendor', 'payables', 'collections', 'reconciler'], 'Close out with read_audit and give a one-line cited summary. Do not hand off when evidence is complete.', [
    stub('read_audit', 'Read this case\'s audit and evidence chain', none, (_, caseId) => ({ complete: true, artifactRef: `${caseId}:closeout` })),
  ]),
};

export async function createDemoTeam() {
  const control = new MemoryStateStore();
  const repository = await createNorthfieldRepository();
  const payments: string[] = [];
  const seat = new PayablesSeat({ repository, state: control, controller: { request: async () => 'esc-demo' }, paymentRail: 'nessie',
    nessie: { payInvoice: async () => { payments.push(AP_INVOICE); return { id: `nessie-demo-${payments.length}`, status: 'completed' }; } } });
  const fields = northfieldInvoice(AP_INVOICE), source = northfieldSource(AP_INVOICE);
  const evidence = new MemoryVendorEvidenceStore();
  const call: CallRecordView = { callId: 'call-1042', status: 'already_paid', plans: [], escalations: [], links: [] };
  const collectionsCase = { sessionId: 'sess-1042', precall: { clientId: 'client-1042', invoiceId: '1042' } } as unknown as CollectionsCase;
  const registered = createRoleRegistry({
    payables: { seat, repository, controller: { request: async () => 'esc-demo' }, loadCase: async () => ({ fields, source }) },
    vendor: {
      loadCase: async () => ({ vendorId: fields.vendorId, kind: 'invoice', senderDomain: source.senderDomain,
        claimedDomain: source.senderDomain, claimedAccountId: fields.bankAccountId }),
      vendors: repository,
      bankChangeRisk: { check: async () => ({ score: 8, label: 'CRS sandbox (synthetic)', checkedAt: '2026-10-24T12:00:00Z', responseHash: 'a'.repeat(64) }) },
      publicRecords: async () => ({ bankruptcies: 0, evidenceRef: `crs:sha256:${'b'.repeat(64)}` }),
      health: { check: async () => ({ signals: [] }) },
      contact: async () => ({ runId: 'demo', usageUsd: 0, items: [] }),
      budget: new ApifyBudget(), evidence,
    },
    collections: { cases: { load: async () => collectionsCase }, outcomes: { read: async () => call }, audit: control },
  });
  const roles: RoleRegistry = { ...STAND_INS, ...registered };
  return { control, roles, payments, evidence };
}

const ref = (o: unknown[], i: number, key = 'artifactRef') => String((o[i] as Record<string, unknown>)[key]);
const handoff = (to: Role, summary: string, refs: (o: unknown[]) => string[]): ScriptStep =>
  ({ tool: 'handoff', args: o => ({ to, reason: summary, summary, artifactRefs: refs(o) }) });
/** What a model would plausibly do, for the network-free run. Live mode lets Claude choose. */
export const DEMO_SCRIPTS: Record<Role, () => ScriptStep[]> = {
  intake: () => [{ tool: 'read_inbox_item', args: {} }, handoff('extractor', 'Vendor invoice from Papertrail; please extract it.', o => [ref(o, 0)])],
  extractor: () => [{ tool: 'read_document', args: {} }, handoff('vendor', 'Extracted invoice 4401, $640.00, PO-4401; vendor needs verification.', o => [ref(o, 0)])],
  vendor: () => [{ tool: 'get_vendor_master', args: {} }, { tool: 'check_domain', args: { which: 'sender' } },
    { tool: 'check_domain', args: { which: 'claimed' } }, { tool: 'check_business', args: {} },
    { tool: 'conclude_verification', args: { outcome: 'proceed', note: 'Master approves payee; domains match; CRS clean.' } },
    handoff('payables', 'Papertrail verified against the master; domains match and CRS is clean.', o => [ref(o, 4, 'verdictRef')])],
  // After staging, the scripted Payables tries to pay again; the sealed activation must refuse it.
  payables: () => [{ tool: 'evaluate_invoice', args: {} }, { tool: 'read_po', args: {} }, { tool: 'request_payment', args: {} },
    handoff('auditor', 'Invoice 4401 matched its PO and policy allowed it; payment requested once.', o => (o[2] as { evidenceRefs: string[] }).evidenceRefs.slice(0, 3)),
    { tool: 'request_payment', args: {} }],
  collections: () => [{ tool: 'get_call_outcome', args: {} }, handoff('reconciler', 'Client says invoice 1042 is already paid; find the bank evidence.', o => [(o[0] as { allowedRefs: string[] }).allowedRefs[0]!])],
  reconciler: () => [{ tool: 'match_payment', args: {} }, handoff('auditor', 'Claimed payment matched exactly in the bank feed.', o => [ref(o, 0)])],
  auditor: () => [{ tool: 'read_audit', args: {} }],
};
