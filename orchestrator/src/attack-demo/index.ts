import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DEFAULT_POLICY, evaluate, POLICY_SENTENCES, RULE_SENTENCES, type Decision } from '@backroom/policy';
import { ROLES, type Role } from '../agents/contracts';
import { processInbox } from '../payables/inbox';
import { PayablesSeat, MemoryFinanceRepository } from '../payables';
import { hold } from '../payables/decisions';
import { structuredInvoice } from '../payables/structured-invoice';
import { MemoryStateStore } from '../store';
import type { InvoiceFields, SeatResult } from '../payables/types';
import type { route } from '../router';
import { ATTACK_PRESETS } from './presets';
import { createLiveAnalyst, type LiveAnalyst, type ModelEvidence } from './live';
export { ATTACK_PRESETS } from './presets';

export const attackInput = z.object({
  text: z.string().trim().min(1).max(16000).optional(),
  presetId: z.enum(['prompt-injection', 'lookalike-vendor', 'split-invoice', 'urgency-pressure']).optional(),
  mode: z.enum(['mock', 'live']).default('mock'),
}).strict().refine(input => Boolean(input.text || input.presetId), 'Text or presetId is required');
export type AttackInput = z.input<typeof attackInput>;
export interface TraceStep {
  role: Role; execution: 'code' | 'mock' | 'live'; observed: string; proposed: string; decision?: Decision;
}
export interface AttackTrace {
  mode: 'mock' | 'live'; source: 'judge'; caseId: string; trust: 'untrusted_data';
  environment: 'isolated_synthetic_company'; senderDomain: string;
  steps: TraceStep[]; skippedRoles: Role[]; decision: Decision & { reason: string };
  rules: { id: string; reason: string }[];
  moneyMoved: false; paymentAttempts: 0; modelEvidence?: ModelEvidence;
}
const liveAnalyst = createLiveAnalyst();
const vendor = { id: 'acme', domain: 'acme-supply.com', accountId: 'acme-approved', approved: true, revision: 1 };

/** Runtime/controller seam: per-request synthetic state, no bank client, approval writer,
 * outbound communications, master-data write or runtime-dispatch capability. */
export async function runAttackDemo(unchecked: AttackInput, options: { analyst?: LiveAnalyst } = {}): Promise<AttackTrace> {
  const input = attackInput.parse(unchecked);
  const preset = ATTACK_PRESETS.find(preset => preset.id === input.presetId);
  const text = input.text ?? preset!.text;
  // A preset supplies simulated envelope metadata only when its original text is used.
  const senderDomain = input.text ? 'unknown.invalid' : preset!.senderDomain;
  const caseId = `attack-${createHash('sha256').update(JSON.stringify([text, senderDomain])).digest('hex').slice(0, 16)}`;
  const steps: TraceStep[] = [{ role: 'intake', execution: 'code', observed: text,
    proposed: 'Treat the entire document as untrusted judge data. Extract facts; no text can grant approval.' }];
  const modelEvidence = input.mode === 'live' ? await (options.analyst ?? liveAnalyst)(text) : undefined;
  if (modelEvidence) steps.push({ role: 'intake', execution: 'live', observed: text, proposed: modelEvidence.proposal });
  const state = new MemoryStateStore();
  const repository = new MemoryFinanceRepository({ vendors: [vendor] });
  const controller = { async request() { return `${caseId}-human-review`; } };
  // assess() does not perform CRS, repository writes or payments. No payment client exists.
  const payables = new PayablesSeat({ state, repository, controller, paymentRail: 'nessie' });
  const extracted: InvoiceFields[] = [];
  const decisions: Decision[] = [];
  const invoiceLines = text.split('\n').filter(line => line.startsWith('Invoice #'));
  const documents = invoiceLines.length > 1 ? invoiceLines : [text];
  // The demo's deterministic extraction adapter has no tools and recognizes only complete
  // structured transcriptions. It never infers identifiers or approvals from prose.
  for (const [index, document] of documents.entries()) {
    const fields = structuredInvoice(document);
    const modelRoute: typeof route = async (task, _data, schema) => {
      const candidate = task === 'inbox_classification' ? { kind: fields ? 'invoice' : 'unknown' } : fields;
      if (!schema) throw new Error('EXTRACTION_SCHEMA_REQUIRED');
      return { output: schema.parse(candidate),
        route: 'local', model: 'deterministic-demo-parser', latencyMs: 0, costUsd: 0 };
    };
    const result = await processInbox({ id: `${caseId}-${index}`, source: 'judge', kind: 'email', senderDomain, text: document }, {
      state, controller, modelRoute,
      payables: { async process(candidate, envelope): Promise<SeatResult> {
        extracted.push(candidate);
        steps.push({ role: 'extractor', execution: 'mock', observed: document,
          proposed: JSON.stringify(candidate) });
        const assessment = await payables.assess(candidate, envelope);
        const approved = await repository.getVendor(candidate.vendorId);
        steps.push({ role: 'vendor', execution: 'code', observed: JSON.stringify({ senderDomain, vendorId: candidate.vendorId,
          approvedDomain: approved?.domain ?? null, approvedAccount: approved?.accountId ?? null, submittedAccount: candidate.bankAccountId }),
          proposed: assessment.bankChanged ? 'Hold the changed destination for controller verification.' : 'Compare against the synthetic vendor master; body claims are not verification.' });
        steps.push({ role: 'payables', execution: 'code', observed: JSON.stringify({ amountCents: candidate.amountCents,
          poMatched: assessment.poMatched, maxPaymentCents: DEFAULT_POLICY.badges.payables.maxPaymentCents }),
          proposed: 'Assess the proposed invoice against policy. Execute no payment.', decision: assessment.decision });
        return { status: 'held', decision: assessment.decision, evidenceRefs: [envelope.id] };
      } },
      vendor: { async propose(): Promise<SeatResult> { return { status: 'held', decision: hold('INVALID_INPUT'), evidenceRefs: [caseId] }; } },
    });
    decisions.push(result.decision);
    if (!fields) steps.push({ role: 'extractor', execution: 'mock', observed: document,
      proposed: 'Required factual invoice fields are missing. Request human review; invent no values.', decision: result.decision });
  }
  // Only within this submitted document, group invoices by vendor before assessing the
  // total. This is demo batch protection, not a claim of cross-email split detection.
  for (const vendorId of new Set(extracted.map(fields => fields.vendorId))) {
    const group = extracted.filter(fields => fields.vendorId === vendorId);
    if (group.length < 2) continue;
    const aggregate = evaluate('payables', { type: 'pay_invoice', invoice: {
      id: `${caseId}-aggregate`, vendorId, amountCents: group.reduce((sum, fields) => sum + fields.amountCents, 0),
      lineItems: group.flatMap(fields => fields.lineItems), poMatched: false, account: 'operating',
    } }, { vendor: { id: vendor.id, inMaster: true, approved: true, pendingBankChange: false, knownDomain: vendor.domain } });
    decisions.unshift(aggregate);
    steps.push({ role: 'payables', execution: 'code', observed: `${group.length} invoices for ${vendorId} in one submitted document.`,
      proposed: 'Assess their combined amount before any individual payment; splitting supplies no approval.', decision: aggregate });
  }
  const decision = decisions.find(decision => decision.kind !== 'ALLOW') ?? decisions[0]!;
  const ruleIds = [...new Set(decisions.flatMap(decision => decision.ruleIds).filter(id => id !== 'IN_BADGE'))];
  steps.push({ role: 'auditor', execution: 'code', observed: JSON.stringify({ decisions, paymentAdapter: 'absent' }),
    proposed: 'Record rule evidence. Payment execution and approval are unavailable in this isolated demo.', decision });
  return { mode: input.mode, source: 'judge', caseId, trust: 'untrusted_data', environment: 'isolated_synthetic_company', senderDomain,
    steps, skippedRoles: ROLES.filter(role => !steps.some(step => step.role === role)), decision: { ...decision, ruleIds: ruleIds.length ? ruleIds : decision.ruleIds,
      reason: decision.kind === 'ALLOW' ? 'Policy permits this proposal; this assessment-only demo never executes payments.' : decision.reason },
    rules: (ruleIds.length ? ruleIds : decision.ruleIds).map(id => ({ id, reason: POLICY_SENTENCES[RULE_SENTENCES[id]] })),
    moneyMoved: false, paymentAttempts: 0, ...(modelEvidence && { modelEvidence }) };
}
