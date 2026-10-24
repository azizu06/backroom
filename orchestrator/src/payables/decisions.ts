import { DEFAULT_POLICY, POLICY_SENTENCES, RULE_SENTENCES, type Decision, type RuleId, type Badge } from '@backroom/policy';
import type { AuditInput, Lease, StateStore } from '../store';
import type { ControllerPort, InboxSource, SeatOptions } from './types';

export function hold(rule: RuleId): Extract<Decision, { kind: 'ESCALATE' }> {
  const sentenceId = RULE_SENTENCES[rule];
  return { kind: 'ESCALATE', ruleIds: [rule], policyVersion: DEFAULT_POLICY.policyVersion,
    toHuman: DEFAULT_POLICY.toHuman, reason: POLICY_SENTENCES[sentenceId],
    quote: { sentenceId, text: POLICY_SENTENCES[sentenceId] } };
}
export function domain(value: string): string { return value.trim().toLowerCase().replace(/\.$/, ''); }
export function validDomain(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain(value));
}
export async function audit(options: Pick<SeatOptions, 'state' | 'now'>, seat: Badge, action: string, source: InboxSource,
  decision: Decision, refs: string[], inputs: Record<string, unknown> = {}, actor: AuditInput['actor'] = 'code') {
  await options.state.appendAudit({ ts: (options.now ?? Date.now)(), actor, seat, action,
    decision: decision.kind, ruleIds: decision.ruleIds, policyVersion: decision.policyVersion,
    route: 'code', latencyMs: 0, costUsd: 0, refs: [source.id, ...refs],
    inputs: { ...inputs, scenario_source: source.source, decision } });
}
/** Bind to a real claimed task; controller approval writes stay in the passkey service. */
export function controllerForLease(store: StateStore, lease: Lease, now = Date.now): ControllerPort {
  return {
    async request(decision, refs) {
      await store.assertLease(lease, now());
      if (!refs.every(ref => lease.refs.includes(ref))) throw new Error('ESCALATION_REFS_NOT_IN_TASK');
      const escalation = await store.createEscalation(lease, decision, now());
      await store.setAgentTarget(lease, `${decision.toHuman}_desk`, now());
      return escalation.id;
    },
    get: id => store.getEscalation(id),
  };
}
