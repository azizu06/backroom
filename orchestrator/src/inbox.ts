import { createRouter, isLlmOff, type RouterOptions } from './router';
import { getStateStore } from './runtime';
import type { Seat, StateStore } from './store';
import { hold } from './payables/decisions';

export interface InboxItem {
  id: string;
  kind: 'invoice' | 'bank_change' | 'client_message' | 'vendor_message' | 'email';
  subject?: string;
  /** Trusted server intake metadata, never a model classification. */
  source?: 'seed' | 'judge';
}
/** Routing never grants payment authority. Raw judge mail has no validated recognized
 * action: escalate here, or use processInbox for schema-validated extraction/dispatch.
 */
export async function routeInboxItem(item: InboxItem, store: StateStore = getStateStore(), options: RouterOptions = {}) {
  const deterministic: Seat = item.kind === 'invoice' || item.kind === 'bank_change' ? 'payables'
    : item.kind === 'client_message' ? 'collections' : 'vendor_onboarding';
  let seat = deterministic;
  let source: 'code' | 'model' = 'code';
  let metadata = { route: 'code', latencyMs: 0, costUsd: 0 };
  if (item.source === 'judge' && !['invoice', 'bank_change', 'client_message', 'vendor_message'].includes(item.kind)) {
    const decision = hold('INVALID_INPUT');
    const id = `judge-inbox:${encodeURIComponent(item.id)}`;
    const escalation = await store.createCallEscalation({ id, taskId: id, fromAgent: `intake:${id}`,
      seat, toHuman: decision.toHuman, ruleIds: decision.ruleIds, evidenceRefs: [item.id],
      policyVersion: decision.policyVersion, quote: decision.quote }, Date.now());
    await store.appendAudit({ ts: Date.now(), actor: 'code', seat, action: 'route_inbox_item',
      ruleIds: decision.ruleIds, policyVersion: decision.policyVersion, refs: [item.id, escalation.id],
      decision: 'ESCALATE', inputs: { kind: item.kind, routedSeat: seat, scenario_source: 'judge' }, ...metadata });
    return { seat, source, decision: 'ESCALATE' as const, escalationId: escalation.id };
  }
  // Typed invoice/bank-change records always reach AP; no model may reroute a trap.
  if (store.llmEnabled && item.kind === 'email') {
    try {
      const result = await createRouter({ ...options, stateStore: store }).route('inbox_classification', {
        id: item.id, kind: item.kind, subject: item.subject?.slice(0, 500),
      }, { parse(value: unknown): Seat {
        if (!value || typeof value !== 'object' || !('seat' in value) ||
          !['collections', 'payables', 'vendor_onboarding'].includes(String(value.seat))) throw new Error('INVALID_SEAT');
        return value.seat as Seat;
      } });
      if (!isLlmOff(result) && store.llmEnabled) {
        seat = result.output; source = 'model'; metadata = result;
      }
    } catch { /* Unavailable/invalid models fall back to the same deterministic queue. */ }
  }
  await store.appendAudit({ ts: Date.now(), actor: source === 'code' ? 'code' : metadata.route === 'local' ? 'local_model' : 'claude',
    seat, action: 'route_inbox_item', ruleIds: ['INBOX_ROUTING'], policyVersion: 0, refs: [item.id],
    inputs: { kind: item.kind, routedSeat: seat, scenario_source: item.source ?? 'seed' }, ...metadata });
  return { seat, source };
}
