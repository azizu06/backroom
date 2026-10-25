import type { StateStore } from '@backroom/orchestrator';
import type { GatewayCall, ToolResult } from '../gateway/store';
import type { Invocation } from '../gateway/parser';
import { noteEscalation } from './inbox';
import { publishCallEscalation, resolveCallEscalation } from '../calls/handoffs';
import { VOICE_AGENT } from '../calls/presence';

// Office projection writes are display only: a failure is logged and never changes the tool result.
const logged = (what: string) => (error: unknown) => { console.error(what, error); };

/** Both adapters are server-only. The voice handler can create/read requests, never decide them. */
export function createApprovalBridge(store: StateStore, now = Date.now) {
  return async (call: GatewayCall, input: Invocation, result?: ToolResult) => {
    // The live voice agent is on a call while its tools run; presence grants no authority.
    if (!result && call.agentId === VOICE_AGENT)
      await store.setCallPresence(VOICE_AGENT, 'collections', true, now()).catch(logged('voice presence refresh failed'));
    await store.expireEscalations(now());
    // Refresh before the tool runs so an expired row is not still "pending" on a re-ask.
    for (const local of call.escalations) {
      const row = await store.getEscalation(local.id);
      if (!row || row.callId !== call.callId) continue;
      const changed = local.status !== row.status;
      local.status = row.status;
      local.method = row.method;
      local.decision = row.decision;
      local.decidedAt = row.decidedAt;
      local.createdAt = row.createdAt;
      local.expiresAt = row.expiresAt;
      if (changed) await resolveCallEscalation(row).catch(logged('call escalation handoff resolve failed'));
    }
    if (result?.kind !== 'ESCALATE' || typeof result.escalation_id !== 'string') return;
    const local = call.escalations.find(e => e.id === result.escalation_id)!;
    const audit = call.audits.find(a => a.id === result.audit_id);
    if (audit?.decision?.kind !== 'ESCALATE') throw new Error('ESCALATION_EVIDENCE_REQUIRED');
    const row = await store.createCallEscalation({
      id: local.id, taskId: `call:${call.callId}`, callId: call.callId, invoiceId: call.invoiceId,
      fromAgent: call.agentId ?? `collections:${call.callId}`, seat: 'collections',
      toHuman: local.toHuman, ruleIds: local.ruleIds, evidenceRefs: [audit.id, call.invoiceId],
      policyVersion: audit.policyVersion, quote: audit.decision.quote,
      amountCents: call.amountCents, principalCents: call.receivable.principalCents,
      lateFeeCents: call.receivable.lateFeeCents, currency: call.currency, requestedTerms: local.plan,
    }, now());
    noteEscalation(row.id);
    await publishCallEscalation(row).catch(logged('call escalation handoff failed'));
    local.createdAt = row.createdAt;
    local.expiresAt = row.expiresAt;
    result.approval_path = `/approve/${encodeURIComponent(row.id)}`;
  };
}
