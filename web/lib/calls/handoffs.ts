import type { Escalation } from '@backroom/orchestrator';
import type { AgentCaseStore, HumanOutcome } from '@backroom/orchestrator/agents';

/** Live-call escalations in the office: the trusted host publishes each policy escalation to Dana
 * through the shared agent handoff store (`agent_handoff_public`) and closes it from the persisted
 * decision. Installed by the demo bootstrap with the same store the role agents use. */
const root = globalThis as typeof globalThis & { backroomCallHandoffs?: Pick<AgentCaseStore, 'escalateToHuman' | 'resolveHumanEscalation'> };
export function installCallHandoffs(store: Pick<AgentCaseStore, 'escalateToHuman' | 'resolveHumanEscalation'> | undefined) {
  root.backroomCallHandoffs = store;
}
export const callCaseId = (callId: string) => `call:${callId}`;

export async function publishCallEscalation(row: Escalation): Promise<void> {
  const store = root.backroomCallHandoffs;
  if (!store || !row.callId) return;
  await store.escalateToHuman({ caseId: callCaseId(row.callId), displayId: row.invoiceId ?? row.callId, from: 'collections',
    escalationId: row.id, toHuman: row.toHuman, ruleIds: row.ruleIds,
    artifactRefs: [row.id, ...(row.invoiceId ? [`ar_invoice:${row.invoiceId}`] : [])] });
}

const OUTCOMES: Partial<Record<Escalation['status'], HumanOutcome>> = {
  approved: 'approved', denied: 'denied', counter: 'counter', expired: 'expired', pending_owner: 'pending_owner',
};
/** A still-pending row, a non-call escalation or an unpublished one leaves the office unchanged. */
export async function resolveCallEscalation(row: Escalation | undefined): Promise<void> {
  const store = root.backroomCallHandoffs, outcome = row && OUTCOMES[row.status];
  if (!store || !row?.callId || !outcome) return;
  await store.resolveHumanEscalation(callCaseId(row.callId), row.id, outcome);
}
