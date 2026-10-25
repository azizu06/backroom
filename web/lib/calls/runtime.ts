import { getStateStore } from '@backroom/orchestrator';
import { getGatewayStore } from '../gateway/runtime';
import { voiceCallLifecycle } from './lifecycle';
import { MAX_CALL_MS, projectVoiceCall, type CallProjectionRow } from './projection';
import { declaredLoopbackOfficeOrigin } from './loopback-origin';
import { createCallRequestHTTP, type CallFollowUpResult, type CallRequestAudit, type EmailOnlyScenario } from './request';

const ENDED_VISIBLE_MS = 2 * 60_000;
const POLICY_REFUSALS = new Set(['PRECALL_BLOCKED', 'CALL_DENIED', 'CLIENT_STOPPED']);

/** Only policy or legal guardrail outcomes belong in the decision feed. */
export function officeCallAuditDecision(entry: CallRequestAudit): 'ALLOW' | 'DENY' | undefined {
  if (entry.outcome === 'accepted') return 'ALLOW';
  if (entry.outcome === 'refused' && POLICY_REFUSALS.has(entry.code)) return 'DENY';
}

/** The desk phone's current call, or null once the last one ended a while ago. */
export async function activeCall(now = Date.now()): Promise<CallProjectionRow | null> {
  const call = await getGatewayStore().latestVoiceCall?.();
  if (!call) return null;
  const lifecycle = voiceCallLifecycle(call.callId) ?? {};
  const store = getStateStore();
  const escalations = Object.fromEntries(await Promise.all(call.escalations.map(async escalation =>
    [escalation.id, await store.getEscalation(escalation.id).catch(() => undefined)] as const)));
  // A stopped call's last gateway audit is its stop; the shared chain holds that audit's time.
  const stop = call.status !== 'active' ? call.audits.at(-1) : undefined;
  const stoppedAt = stop && (await store.getAudit(stop.id).catch(() => undefined))?.ts;
  const row = projectVoiceCall(call, lifecycle, { now, escalations, ...(stoppedAt !== undefined && { stoppedAt }) });
  const endedAt = row.endedAt ?? (lifecycle.registeredAt ?? now) + MAX_CALL_MS;
  return row.status === 'ended' && now - endedAt > ENDED_VISIBLE_MS ? null : row;
}

// One per server process, so the single-flight and cooldown hold across route chunks.
const root = globalThis as typeof globalThis & {
  backroomCallRequests?: ReturnType<typeof createCallRequestHTTP>;
  backroomCallRefusalFollowUp?: (entry: CallRequestAudit) => Promise<CallFollowUpResult | undefined>;
  backroomEmailOnlyRefusal?: (scenario: EmailOnlyScenario) => Promise<string[] | undefined>;
};
/** Installed only by the trusted demo bootstrap; ordinary Next imports remain call-only. */
export function installCallRefusalFollowUp(handler: typeof root.backroomCallRefusalFollowUp) {
  root.backroomCallRefusalFollowUp = handler;
}
/** Installed only by the trusted demo bootstrap; without it a seeded email-only request is refused as unavailable. */
export function installEmailOnlyRefusal(handler: typeof root.backroomEmailOnlyRefusal) {
  root.backroomEmailOnlyRefusal = handler;
}
export const handleCallRequest: ReturnType<typeof createCallRequestHTTP> = request => (root.backroomCallRequests ??= createCallRequestHTTP({
  secret: () => process.env.CONTROLLER_ENROLLMENT_SECRET,
  origin: () => process.env.WEBAUTHN_ORIGIN,
  // The public office and this host's own loopback office, and no other origin.
  loopbackOrigin: () => declaredLoopbackOfficeOrigin(),
  // demo:up starts the relay on loopback and shares its admin secret with this host only.
  relay: () => process.env.DEMO_VOICE_RUNNING === '1' && process.env.VOICE_ADMIN_SECRET
    ? { url: `http://127.0.0.1:${Number(process.env.VOICE_PORT || 8788)}/_admin/dial`, secret: process.env.VOICE_ADMIN_SECRET } : undefined,
  currentCall: () => activeCall(),
  followUp: async entry => root.backroomCallRefusalFollowUp?.(entry),
  emailOnlyRefusal: async scenario => root.backroomEmailOnlyRefusal?.(scenario),
  audit: async entry => {
    const store = getStateStore();
    const decision = officeCallAuditDecision(entry);
    await store.appendAudit({ ts: Date.now(), actor: 'code', seat: 'collections', action: `office_call_${entry.outcome}`, ruleIds: [],
      policyVersion: (await store.getPolicy()).policyVersion, refs: ['1042'], route: 'code',
      ...(decision && { decision }),
      inputs: { ...entry, source: 'office_button', destination: 'server_allowlisted_demo_phone' }, latencyMs: 0, costUsd: 0 });
  },
}))(request);
