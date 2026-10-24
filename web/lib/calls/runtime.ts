import { getStateStore } from '@backroom/orchestrator';
import { getGatewayStore } from '../gateway/runtime';
import { voiceCallLifecycle } from './lifecycle';
import { MAX_CALL_MS, projectVoiceCall, type CallProjectionRow } from './projection';
import { createCallRequestHTTP } from './request';

const ENDED_VISIBLE_MS = 2 * 60_000;
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
const root = globalThis as typeof globalThis & { backroomCallRequests?: ReturnType<typeof createCallRequestHTTP> };
export const handleCallRequest: ReturnType<typeof createCallRequestHTTP> = (action, request) => (root.backroomCallRequests ??= createCallRequestHTTP({
  secret: () => process.env.CONTROLLER_ENROLLMENT_SECRET,
  origin: () => process.env.WEBAUTHN_ORIGIN,
  // The tunnel office cannot open ws://127.0.0.1. The host office can, so the dial route
  // accepts that exact loopback origin and no other. Public origins stay on WEBAUTHN_ORIGIN.
  loopbackOrigin: () => {
    const port = process.env.DEMO_PORT || '3000';
    return /^[1-9]\d{0,4}$/.test(port) && Number(port) <= 65535 ? `http://127.0.0.1:${Number(port)}` : undefined;
  },
  // demo:up starts the relay on loopback and shares its admin secret with this host only.
  relay: () => process.env.DEMO_VOICE_RUNNING === '1' && process.env.VOICE_ADMIN_SECRET
    ? { url: `http://127.0.0.1:${Number(process.env.VOICE_PORT || 8788)}/_admin/dial`, secret: process.env.VOICE_ADMIN_SECRET } : undefined,
  currentCall: () => activeCall(),
  audit: async entry => {
    const store = getStateStore();
    await store.appendAudit({ ts: Date.now(), actor: 'code', seat: 'collections', action: `office_call_${entry.outcome}`, ruleIds: [],
      policyVersion: (await store.getPolicy()).policyVersion, refs: ['1042'], route: 'code',
      ...(entry.outcome !== 'requested' && { decision: entry.outcome === 'accepted' ? 'ALLOW' as const : 'DENY' as const }),
      inputs: { ...entry, source: 'office_button', destination: 'server_allowlisted_demo_phone' }, latencyMs: 0, costUsd: 0 });
  },
}))(action, request);
