import { createHash } from 'node:crypto';
import type { Escalation, GatewayCall } from '../gateway/store';
import type { VoiceCallLifecycle } from './lifecycle';

/** Diego's provisional desk-phone row (`web/lib/office/calls.ts`, `callFromProjection`). */
export interface CallProjectionRow {
  callId: string; status: 'ringing' | 'live' | 'ended'; direction: 'outbound'; line: 'collections';
  agentId: 'collections'; agentName: 'Collections'; callerLabel: string;
  transcript: { id: string; speaker: 'agent'; agentId: 'collections'; text: string; at: number }[];
  startedAt?: number; endedAt?: number; endReason?: string;
}
/** The approval row as the controller's StateStore holds it; only a passkey decision is shown as decided. */
export type EscalationView = Pick<Escalation, 'status' | 'method'>;

export const RING_TIMEOUT_MS = 90_000;
export const MAX_CALL_MS = 10 * 60_000;
const STOPS: Record<string, string> = {
  record_opt_out: 'Opt-out recorded · collection stopped', mark_dispute: 'Dispute recorded · collection paused',
  request_human: 'Human follow-up requested · collection paused', report_already_paid: 'Reported already paid · collection paused',
};
const STOPPED: Record<Exclude<GatewayCall['status'], 'active'>, string> = {
  opted_out: 'Opt-out recorded', disputed: 'Dispute recorded', human_requested: 'Human follow-up requested', already_paid: 'Reported already paid',
};
const APPROVALS: Record<EscalationView['status'], (human: string) => string> = {
  pending: human => `Waiting for ${human}'s passkey decision`,
  approved: human => `${human} approved with a passkey`,
  denied: human => `${human} denied with a passkey`,
  counter: human => `${human} countered with a passkey`,
  pending_owner: human => `No decision · ${human} will confirm by email`,
  expired: human => `No decision from ${human} in time · request closed`,
};
/** Closed by the clock or call end; a decision counts only when the passkey backend recorded it. */
const shownApproval = (view: EscalationView): EscalationView['status'] =>
  view.status === 'pending_owner' || view.status === 'expired' || (view.status !== 'pending' && view.method === 'passkey') ? view.status : 'pending';

/**
 * Read-only desk-phone view of one live voice call. The transcript is code decisions from the
 * gateway audit, never speech. Amounts and plan terms stay masked until the caller's identity is confirmed.
 * Never includes the phone number, contact name, payment link path or code, or the session id.
 */
export function projectVoiceCall(call: GatewayCall, lifecycle: VoiceCallLifecycle = {},
  options: { now: number; escalations?: Record<string, EscalationView | undefined>;
    /** When the gateway stop was recorded, so a stopped call ends even if the provider's end event is lost. */
    stoppedAt?: number }): CallProjectionRow {
  const money = (cents: number) => call.identityConfirmed
    ? `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$•••';
  const at = lifecycle.startedAt ?? lifecycle.registeredAt ?? 0;
  const transcript: CallProjectionRow['transcript'] = [];
  const say = (id: string, text: string) => transcript.push({ id, speaker: 'agent', agentId: 'collections', text, at });
  const lastIdentity = call.audits.map(audit => audit.action).lastIndexOf('verify_identity_result');
  let escalations = 0, links = 0;
  call.audits.forEach((audit, index) => {
    const verdict = `${audit.action} → ${audit.kind}${audit.ruleIds.length ? ` ${audit.ruleIds.join(', ')}` : ''}`;
    const terms = call.identityConfirmed && audit.plan ? `${audit.plan.installments} payment${audit.plan.installments === 1 ? '' : 's'}`
      + `${audit.plan.waiveFee ? ', fee waived' : ''}${audit.plan.discountPct ? `, ${audit.plan.discountPct}% off` : ''}` : '';
    if (audit.action === 'verify_identity_result') {
      say(audit.id, index !== lastIdentity ? 'Identity check recorded'
        : call.identityConfirmed ? "Identity confirmed from the caller's own answer · amounts unlocked" : 'Identity not confirmed · amounts stay hidden');
    } else if (Object.hasOwn(STOPS, audit.action)) {
      say(audit.id, STOPS[audit.action]!);
    } else if (audit.action === 'send_payment_link' && audit.kind === 'ALLOW') {
      // One link per recorded link ALLOW, in order. The code and path stay with the payer.
      const link = call.links[links++];
      say(audit.id, `Payment link queued${link ? ` · first payment ${money(link.amountCents)}` : ''}`);
    } else if (audit.kind === 'ALLOW') {
      const plan = call.plans.find(row => row.auditId === audit.id);
      say(audit.id, `${verdict}${terms ? ` · ${terms}` : ''}${plan ? `, first ${money(plan.firstPaymentCents)}` : ''}`);
    } else if (audit.kind === 'ESCALATE') {
      // Each ESCALATE audit opens exactly one escalation, in order.
      const escalation = call.escalations[escalations++];
      const human = audit.decision?.kind === 'ESCALATE' ? audit.decision.toHuman : escalation?.toHuman ?? 'a human';
      say(audit.id, `${verdict} → ${human}${terms ? ` · ${terms}` : ''}`);
      if (escalation) {
        const view = options.escalations?.[escalation.id] ?? escalation;
        const status = shownApproval(view);
        say(`${escalation.id}:${status}`, APPROVALS[status](escalation.toHuman));
      }
    } else {
      say(audit.id, `${verdict}${terms ? ` · ${terms}` : ''}`);
    }
  });
  const started = lifecycle.startedAt ?? lifecycle.registeredAt;
  let status: CallProjectionRow['status'] = 'live', endedAt: number | undefined, endReason: string | undefined;
  if (lifecycle.endedAt !== undefined) {
    status = 'ended'; endedAt = lifecycle.endedAt; endReason = call.status !== 'active' ? STOPPED[call.status] : lifecycle.endReason === 'failed' ? 'Call failed' : 'Call ended';
  } else if (call.status !== 'active') {
    status = 'ended'; endedAt = options.stoppedAt; endReason = STOPPED[call.status];
  } else if (lifecycle.startedAt === undefined && !call.audits.length) {
    status = 'ringing';
    if (lifecycle.registeredAt !== undefined && options.now - lifecycle.registeredAt > RING_TIMEOUT_MS) {
      status = 'ended'; endedAt = lifecycle.registeredAt + RING_TIMEOUT_MS; endReason = 'No answer';
    }
  } else if (started !== undefined && options.now - started > MAX_CALL_MS) {
    status = 'ended'; endedAt = started + MAX_CALL_MS; endReason = 'Timed out';
  }
  return { callId: `call-${createHash('sha256').update(call.callId).digest('hex').slice(0, 16)}`, status, direction: 'outbound',
    line: 'collections', agentId: 'collections', agentName: 'Collections', callerLabel: `Demo client · invoice ${call.invoiceId}`,
    transcript: transcript.slice(-50), ...(started !== undefined && { startedAt: started }),
    ...(endedAt !== undefined && { endedAt }), ...(endReason && { endReason }) };
}
