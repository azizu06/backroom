import { MemoryStateStore, type AuditInput } from '@backroom/orchestrator';

const call = 'ea5f9fdd-ee4e-4e37-a072-6adb7606844e', escalation = '3c5a4bde-adc3-4e08-8e76-c52b4a830795';
const trap = 'judge:9b1f2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const quote = { sentenceId: 'NF-012', text: 'A payment plan may not exceed the saved Collections maximum installment count, initially two; ask Dana for an exception.' };
const plumbing = (seat: AuditInput['seat'], method: string): Omit<AuditInput, 'ts'> => ({ actor: 'code', seat, action: `state.${method}`,
  ruleIds: [], policyVersion: 0, refs: [], route: 'code', latencyMs: 0, costUsd: 0 });
const row = (fields: Partial<AuditInput> & Pick<AuditInput, 'action'>): Omit<AuditInput, 'ts'> => ({ actor: 'code', seat: 'collections',
  ruleIds: [], policyVersion: 1, refs: [], route: 'code', latencyMs: 0, costUsd: 0, ...fields });
const gateway = (action: string, fields: Partial<AuditInput> = {}) =>
  row({ action, refs: [call, '1042', 'northfield-jordan'], ...fields, inputs: { invoiceId: '1042', ...fields.inputs } });

/** The judged demo path as the host records it, including a stale run before Reset and reducer plumbing. */
export const DEMO_RUN: Omit<AuditInput, 'ts'>[] = [
  row({ action: 'propose_plan', decision: 'ALLOW', refs: ['old-call', '1042'], inputs: { invoiceId: '1042' } }),
  row({ action: 'seed_company', seat: 'controller', policyVersion: 0, refs: ['fixtures/company/northfield.json'] }),
  plumbing('collections', 'registerAgent'), plumbing('payables', 'registerAgent'),
  row({ action: 'set_llm_enabled', seat: 'controller', actor: 'human' }),
  row({ action: 'office_call_requested', refs: ['1042'], inputs: { outcome: 'requested', code: 'DIAL_REQUESTED', source: 'office_button' } }),
  row({ action: 'office_call_accepted', decision: 'ALLOW', refs: ['1042'], inputs: { outcome: 'accepted', code: 'DIAL_ACCEPTED' } }),
  plumbing('collections', 'enqueueTask'), plumbing('collections', 'claimTask'),
  gateway('verify_identity_result', { ruleIds: ['IDENTITY_RESULT'], inputs: { kind: 'RECORDED' } }),
  row({ action: 'create_escalation', decision: 'ESCALATE', ruleIds: ['MAX_INSTALLMENTS'], refs: [escalation, 'gw-1', '1042'] }),
  gateway('propose_plan', { decision: 'ESCALATE', ruleIds: ['MAX_INSTALLMENTS'], inputs: { kind: 'ESCALATE',
    plan: { installments: 4, firstPaymentPct: 50, durationDays: 30, waiveFee: false, discountPct: 0 },
    decision: { kind: 'ESCALATE', policyVersion: 1, quote, ruleIds: ['MAX_INSTALLMENTS'], toHuman: 'Dana' } } }),
  row({ action: 'decide_escalation', actor: 'human', seat: 'controller', route: 'passkey', ruleIds: ['MAX_INSTALLMENTS'],
    refs: [escalation, 'gw-1', '1042'], inputs: { decision: { kind: 'Approve' }, method: 'passkey' } }),
  gateway('check_approval', { ruleIds: ['MAX_INSTALLMENTS'], inputs: { kind: 'RECORDED' } }),
  gateway('send_payment_link', { ruleIds: ['PAYMENT_LINK'], inputs: { kind: 'RECORDED' } }),
  plumbing('collections', 'completeTask'),
  row({ action: 'record_event', seat: 'controller', policyVersion: 0, refs: ['call-ended'] }),
  row({ action: 'nessie_completed', refs: ['1042', 'link-1'], inputs: { amountCents: 123750 } }),
  plumbing('collections', 'recordPayment'),
  row({ action: 'reconcile', ruleIds: ['EXACT_PAYMENT_MATCH'], refs: ['1042', 'link-1', 'gw-1'],
    inputs: { depositId: 'dep-1', invoiceState: 'partially_paid', amountCents: 123750 } }),
  row({ action: 'create_escalation', seat: 'vendor_onboarding', decision: 'ESCALATE', ruleIds: ['LOOKALIKE_DOMAIN'], refs: ['esc-bank', 'vendor-07'] }),
  row({ action: 'judge_inbox_decision', seat: 'vendor_onboarding', decision: 'DENY', ruleIds: ['LOOKALIKE_DOMAIN', 'BANK_CHANGE_CALLBACK'],
    refs: [trap, 'vendor-07', 'esc-bank'], inputs: { scenario_source: 'judge', kind: 'bank_change', senderDomain: 'northfie1d.co',
      decision: { kind: 'DENY', quote: { sentenceId: 'NF-031', text: 'Bank changes need a callback to the number on file.' } } } }),
];

/** A verified chain built by the real reducer engine, so tests and screenshots see real ids and hashes. */
export async function demoRunSnapshot() {
  const store = new MemoryStateStore();
  let ts = Date.UTC(2026, 9, 25, 17, 30);
  for (const entry of DEMO_RUN) await store.appendAudit({ ...entry, ts: ts += 7_000 });
  return { entries: await store.listAudit(), chain: await store.verifyAuditChain(), measuredAt: new Date(ts).toISOString() };
}
