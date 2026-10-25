import { getStateStore } from '@backroom/orchestrator';

export async function operatorAudit(action: string, requestId: string, phase: 'started' | 'completed' | 'failed' | 'rejected') {
  const store = getStateStore();
  const entry = await store.appendAudit({ ts: Date.now(), actor: 'code', seat: 'controller', action: `operator_${action}`,
    ruleIds: [], policyVersion: (await store.getPolicy()).policyVersion, refs: [requestId], route: 'code', latencyMs: 0, costUsd: 0,
    inputs: { operatorSession: true, requestId, phase, noDial: true, approvalAuthority: false } });
  return entry.id;
}
