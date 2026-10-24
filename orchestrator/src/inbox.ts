import { createRouter, isLlmOff, type RouterOptions } from './router';
import { getStateStore } from './runtime';
import type { Seat, StateStore } from './store';

export interface InboxItem {
  id: string;
  kind: 'invoice' | 'bank_change' | 'client_message' | 'vendor_message' | 'email';
  subject?: string;
}
/** Routing only selects a queue. It never grants a payment or changes vendor state. */
export async function routeInboxItem(item: InboxItem, store: StateStore = getStateStore(), options: RouterOptions = {}) {
  const deterministic: Seat = item.kind === 'invoice' || item.kind === 'bank_change' ? 'payables'
    : item.kind === 'client_message' ? 'collections' : 'vendor_onboarding';
  let seat = deterministic;
  let source: 'code' | 'model' = 'code';
  let metadata = { route: 'code', latencyMs: 0, costUsd: 0 };
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
    inputs: { kind: item.kind, routedSeat: seat }, ...metadata });
  return { seat, source };
}
