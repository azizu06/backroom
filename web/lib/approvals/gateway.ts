import type { StateStore } from '@backroom/orchestrator';
import type { GatewayCall, ToolResult } from '../gateway/store';
import type { Invocation } from '../gateway/parser';

/** Both adapters are server-only. The voice handler can create/read requests, never decide them. */
export function createApprovalBridge(store: StateStore, now = Date.now) {
  return async (call: GatewayCall, input: Invocation, result?: ToolResult) => {
    await store.expireEscalations(now());
    if (input.tool === 'check_approval') {
      const local = call.escalations.find(e => e.id === input.escalationId);
      if (!local) return;
      const row = await store.getEscalation(local.id);
      if (!row || row.callId !== call.callId) return;
      local.status = row.status;
      local.method = row.method;
      local.decision = row.decision;
      local.decidedAt = row.decidedAt;
      local.expiresAt = row.expiresAt;
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
    local.createdAt = row.createdAt;
    local.expiresAt = row.expiresAt;
    result.approval_path = `/approve/${encodeURIComponent(row.id)}`;
  };
}
