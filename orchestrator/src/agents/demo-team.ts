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

/** Synthetic demo team: the merged role modules (intake, extractor, vendor, payables,
 * collections) on network-free Northfield fixtures, plus stand-ins for the auditor (not yet
 * merged) and the reconciler (its real module needs the host's Collections task lease, see
 * roles/reconciler.md). A merged role replaces its stub
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
  const itemRef = `inbox:${AP_INVOICE}`;
  const text = [`From: billing@${source.senderDomain}`, `Invoice ${fields.invoiceId} from Papertrail Print Co`, `PO: ${fields.poId}`,
    ...fields.lineItems.map(l => `${l.description}: ${l.quantity} x $${(l.unitPriceCents / 100).toFixed(2)}`), `Total due: $${(fields.amountCents / 100).toFixed(2)}`].join('\n');
  const extractions = new Map<string, unknown>();
  // Stand-in for the shared GX10 Ollama endpoint: a deterministic local-eyes candidate.
  const gx10: typeof fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ output: fields, confidence: 0.93 }) } }] });
  const registered = createRoleRegistry({
    intake: { readItem: async (_ctx, ref) => ref === itemRef ? { id: itemRef, source: 'seed', senderDomain: source.senderDomain, kind: 'email', text } : undefined,
      state: control, controller: { request: async () => 'esc-intake-demo' }, classify: async () => ({ kind: 'invoice' }) as never },
    extractor: { readDocument: async (_ctx, ref) => ref === itemRef ? { text } : undefined, fetch: gx10,
      saveExtraction: async (ctx, artifact) => { const ref = `extraction:${ctx.activation.caseId}:${extractions.size + 1}`; extractions.set(ref, artifact); return ref; } },
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
  return { control, roles, payments, evidence, extractions };
}

const ref = (o: unknown[], i: number, key = 'artifactRef') => String((o[i] as Record<string, unknown>)[key]);
const handoff = (to: Role, summary: string, refs: (o: unknown[]) => string[]): ScriptStep =>
  ({ tool: 'handoff', args: o => ({ to, reason: summary, summary, artifactRefs: refs(o) }) });
/** What a model would plausibly do, for the network-free run. Live mode lets Claude choose. */
export const DEMO_SCRIPTS: Record<Role, () => ScriptStep[]> = {
  intake: () => [{ tool: 'read_inbox_item', args: { itemRef: `inbox:${AP_INVOICE}` } }, { tool: 'classify_hint', args: { itemRef: `inbox:${AP_INVOICE}` } },
    handoff('extractor', 'Vendor invoice email from Papertrail; please extract it.', () => [`inbox:${AP_INVOICE}`])],
  extractor: () => [{ tool: 'read_document', args: { documentRef: `inbox:${AP_INVOICE}`, chunk: 0 } }, { tool: 'local_extract', args: { documentRef: `inbox:${AP_INVOICE}` } },
    { tool: 'validate_extraction', args: o => ({ documentRef: `inbox:${AP_INVOICE}`, fields: (o[1] as { fields: unknown }).fields }) },
    handoff('vendor', 'Extracted invoice 4401, $640.00, PO-4401; vendor needs verification.', o => [`inbox:${AP_INVOICE}`, ref(o, 2)])],
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
