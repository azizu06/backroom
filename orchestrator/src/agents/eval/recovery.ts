import { Dispatcher, type CaseResult } from '../dispatcher';
import { MemoryHandoffStore } from '../handoff-store';
import { createRoleRegistry, auditorCorrections } from '../roles';
import { MemoryUsageLedger } from '../usage';
import { MemoryStateStore } from '../../store';
import { createNorthfieldRepository, northfieldInvoice, northfieldSource, PayablesSeat } from '../../payables';
import { mockRuntime } from './runtime';
import type { Trace } from './chain';

/** An abandoned scripted query, not a killed OS process. The retained memory repository
 * has already persisted the mock provider receipt; ambiguous in-flight debits are not retried. */
export async function runRecovery(options: { lateCancel?: boolean } = {}) {
  let now = 1000;
  const state = new MemoryStateStore();
  const repository = await createNorthfieldRepository();
  const store = new MemoryHandoffStore({ audit: state, now: () => now, activationLeaseMs: 100 });
  const ledger = new MemoryUsageLedger();
  const fields = northfieldInvoice('4401'), source = northfieldSource('4401');
  const providerRequests: string[] = [];
  const debits = new Set<string>();
  const trace: Trace[] = [];
  const controller = { request: async () => 'mock:P11-human' };
  const seat = new PayablesSeat({ repository, state, controller, paymentRail: 'nessie',
    nessie: { payInvoice: async payment => {
      providerRequests.push(payment.idempotencyKey);
      debits.add(payment.idempotencyKey);
      return { id: 'mock:P11-receipt', status: 'completed' };
    } }, bankChangeRisk: { check: async () => ({ score: 0, label: 'FAKE: synthetic fraud risk (not checked)' }) } });
  const roles = createRoleRegistry({ payables: { seat, repository, controller, loadCase: async () => ({ fields, source }) },
    auditor: { store: state, loadCase: async () => ({ refs: ['P11', source.id, '4401'],
      correctionCount: auditorCorrections((await store.getCase('P11'))!) }),
      loadReceipt: async id => id === 'mock:P11-receipt' ? { id, status: 'completed' } : undefined } });
  let reportDebit!: () => void, release!: () => void;
  const reachedDebit = new Promise<void>(resolve => { reportDebit = resolve; });
  const parked = new Promise<void>(resolve => { release = resolve; });
  const abandoned = new AbortController();
  const runtime = mockRuntime(store, async (spec, ctx, invoke) => {
    if (spec.role === 'payables') {
      await invoke('evaluate_invoice');
      const payment = await invoke('request_payment');
      if (ctx.activation.leaseOwner === 'abandoned') {
        reportDebit();
        await parked;
        // A late result/tool call from the dead runner must fail at the actual MCP fence.
        try { await invoke('request_payment'); } catch { /* expected stale/cancelled query */ }
        return;
      }
      await invoke('handoff', { to: 'auditor', artifactRefs: [...ctx.activation.artifactRefs,
        ...((payment.evidenceRefs ?? []) as string[])], reason: 'Recheck persisted receipt after expired runner takeover',
        summary: 'Synthetic payment receipt recovered; audit the one payment, do not debit again.' });
    } else if (spec.role === 'auditor') {
      if (options.lateCancel) {
        // Cancel the old request while the replacement is active, not after it has finished.
        abandoned.abort('CANCELLED');
        release();
        await pending;
      }
      await invoke('read_audit');
      const check = await invoke('verify_chain');
      if (check.decision !== 'ALLOW') throw new Error('P11_AUDIT_INVALID');
      const citations = check.auditIds as string[];
      await invoke('record_case_summary', { summary: `Offline recovery ${citations.map(id => `[entry:${id}]`).join(' ')}`, citations });
    }
  }, (role, tool, output) => trace.push({ role, tool, output }));
  const request = { caseId: 'P11', role: 'payables' as const, credentialOwnerId: 'offline',
    artifactRefs: ['ap_invoice:4401', source.id, '4401'], input: {} };
  const dead = new Dispatcher({ runtime, store, ledger, control: state, roles, runnerId: 'abandoned' });
  const pending = dead.runCase({ ...request, signal: abandoned.signal });
  let replacement: CaseResult | undefined, original: CaseResult | undefined;
  let abandonedToken = 0, replacementToken = 0, paymentPersistedBeforeAbandon = false;
  try {
    await Promise.race([reachedDebit, pending.then(() => { throw new Error('P11_DID_NOT_REACH_CHECKPOINT'); })]);
    const before = (await store.getCase('P11'))!;
    abandonedToken = before.leaseToken;
    paymentPersistedBeforeAbandon = (await repository.getInvoice(fields.vendorId, fields.invoiceId))?.result.status === 'paid';
    now += 100; // exact expiry boundary, no real-time wait or provider operation
    const next = new Dispatcher({ runtime, store, ledger, control: state, roles, runnerId: 'replacement' });
    replacement = await next.recoverCase(request);
    replacementToken = (await store.getCase('P11'))!.leaseToken;
  } finally {
    if (options.lateCancel) abandoned.abort('CANCELLED');
    release();
    original = await pending;
  }
  if (!replacement || !original) throw new Error('P11_RECOVERY_INCOMPLETE');
  const final = (await store.getCase('P11'))!;
  const invoiceStatus = (await repository.getInvoice(fields.vendorId, fields.invoiceId))?.result.status;
  const audits = await state.listAudit();
  const recoveryAudits = audits.filter(row => row.action === 'agent_activation_recovered').length;
  const rejectedWrites = audits.filter(row => row.action === 'agent_activation_write_rejected').length;
  const auditValid = (await state.verifyAuditChain()).valid;
  const activeActivations = final.activations.filter(row => row.status === 'active').length;
  const sameCase = original.caseId === request.caseId && replacement.caseId === request.caseId;
  const match = sameCase && paymentPersistedBeforeAbandon && replacement.status === 'done' && original.status === 'failed' &&
    replacementToken > abandonedToken && providerRequests.length === 1 && debits.size === 1 && invoiceStatus === 'paid' &&
    final.status === 'done' && activeActivations === 0 && recoveryAudits === 1 && rejectedWrites > 0 && auditValid;
  const compact = (row: CaseResult) => ({ status: row.status, reason: row.reason, roles: row.activations.map(a => a.role) });
  return { id: 'P11', outcome: match ? 'RECOVERED_ONE_MOCK_DEBIT' : 'RECOVERY_FAILED', sameCase, abandonedToken,
    replacementToken, paymentPersistedBeforeAbandon, providerRequests, mockDebits: debits.size, invoiceStatus,
    caseStatus: final.status, activeActivations, recoveryAudits, rejectedWrites, auditValid,
    original: compact(original), replacement: compact(replacement), lateCancel: options.lateCancel ?? false,
    tools: trace.map(row => `${row.role}.${row.tool}`),
    scope: 'Production runtime/dispatcher, expired-activation takeover and Payables replay on retained memory state. Scripted query abandoned after the mock receipt was persisted, before handoff/completion; no OS process kill, durable restart, uncertain debit retry or real provider debit.' };
}
