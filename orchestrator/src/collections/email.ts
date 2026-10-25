import { DEFAULT_POLICY, evaluate, type Context, type Decision } from '@backroom/policy';
import type { AuditInput, StateStore } from '../store';

/** Rules after which a client is email-only (spec §1.4): consumer clients, opted-out clients, no call consent. */
export const EMAIL_ONLY_RULES = ['B2B_ONLY_CALLS', 'DNC', 'CONSENT_REQUIRED'] as const;
export const EMAIL_LABEL = 'SIMULATED: email preview, not sent';

export interface EmailFollowUpInput {
  clientId: string; invoiceId: string; businessName: string; contactName: string;
  /** Address on file. Never written to the audit chain; only its domain is. */
  email?: string;
  callbackNumber: string;
  /** Built from current trusted state, same shape as the pre-call context. */
  context: Context;
  /** Set only after the contact confirmed identity (e.g. replied from the address on file and was verified). */
  identityVerified?: boolean;
  /** An allowed pay-in-full link, attached only when identity is verified. */
  payLink?: { id: string; url: string };
}
export interface SimulatedEmail { key: string; to: string; subject: string; body: string; label: typeof EMAIL_LABEL; linkId?: string }
export interface EmailOutbox { queue(email: SimulatedEmail): Promise<'queued' | 'duplicate'> }
export class MemoryEmailOutbox implements EmailOutbox {
  readonly sent: SimulatedEmail[] = [];
  async queue(email: SimulatedEmail) {
    if (this.sent.some(row => row.key === email.key)) return 'duplicate' as const;
    this.sent.push(structuredClone(email)); return 'queued' as const;
  }
}
export interface EmailFollowUpDeps { audit: Pick<StateStore, 'appendAudit'>; outbox: EmailOutbox; now?: () => number }
export type EmailFollowUpResult =
  | { status: 'queued' | 'duplicate'; key: string; withLink: boolean; ruleIds: string[] }
  | { status: 'not_needed'; reason: 'CALL_ALLOWED' }
  | { status: 'blocked'; reason: string; decision?: Decision };

/** The message itself: AI disclosure, the business it speaks for, how to verify and opt out. No amount or invoice
 * detail is included until identity is verified; the pay link (which shows the amount) only follows verification. */
export function composeFollowUp(input: EmailFollowUpInput): { subject: string; body: string; withLink: boolean } {
  const withLink = input.identityVerified === true && !!input.payLink;
  const lines = [
    `Hello ${input.contactName},`, '',
    `This is an automated message from an AI assistant on behalf of ${input.businessName} about your account with us.`,
    withLink
      ? `Thank you for confirming your details. You can review and pay securely here: ${input.payLink!.url}`
      : `To keep your information private, we will only share account details after you confirm you are the right contact. Please reply to this email or call us at ${input.callbackNumber}.`,
    '', `If you would prefer not to receive these messages, reply STOP and we will not contact you again about this.`,
    '', input.businessName,
  ];
  return { subject: `A message from ${input.businessName} about your account`, body: lines.join('\n'), withLink };
}

/** Email-only follow-up when the client must not be called. Code decides whether it may be sent; nothing is delivered. */
export async function runEmailFollowUp(input: EmailFollowUpInput, deps: EmailFollowUpDeps): Promise<EmailFollowUpResult> {
  const now = deps.now ?? Date.now;
  const policy = input.context.policy ?? DEFAULT_POLICY;
  const domain = input.email?.split('@')[1]?.toLowerCase();
  const audit = (action: string, fields: Partial<AuditInput>) => deps.audit.appendAudit({ ts: now(), actor: 'code', seat: 'collections', action,
    ruleIds: [], policyVersion: policy.policyVersion, refs: [input.clientId, input.invoiceId], route: 'code', latencyMs: 0, costUsd: 0, ...fields });
  const blocked = async (reason: string, decision?: Decision): Promise<EmailFollowUpResult> => {
    await audit('email_followup_blocked', { decision: decision?.kind ?? 'DENY', ruleIds: decision?.ruleIds ?? [reason],
      inputs: { channel: 'email', reason, ...(domain ? { toDomain: domain } : {}) } });
    return { status: 'blocked', reason, ...(decision ? { decision } : {}) };
  };
  // The policy decides first. Hard stops (OFAC, closed business, bankruptcy, dispute) come back as its own ESCALATE
  // decision and end all collection contact, by any channel.
  const call = evaluate('collections', { type: 'call_client' }, input.context);
  if (call.kind === 'ALLOW') return { status: 'not_needed', reason: 'CALL_ALLOWED' };
  if (call.kind !== 'DENY' || !call.ruleIds.every(rule => (EMAIL_ONLY_RULES as readonly string[]).includes(rule))) {
    const stop = call.ruleIds.find(rule => rule.endsWith('_STOP'));
    return blocked(stop ?? 'NOT_EMAIL_ELIGIBLE', call);
  }
  // Email-only still respects the client's local contact window. Policy returns the first failing rule, so the window
  // is re-checked by policy itself with only the email-only reasons cleared: same predicate, same invalid-time refusal,
  // same visible-and-logged DEMO_OVERRIDE.
  const hours = evaluate('collections', { type: 'call_client' }, windowProbe(input.context));
  if (hours.kind !== 'ALLOW') return blocked(hours.ruleIds[0] ?? 'CALL_WINDOW', hours);
  const ruleIds = [...call.ruleIds, ...hours.ruleIds.filter(rule => rule === 'DEMO_OVERRIDE')];
  if (!input.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) return blocked('NO_EMAIL_ON_FILE');
  const message = composeFollowUp(input);
  // One follow-up per invoice per UTC day, whatever it says: a same-day verification does not earn a second email.
  const key = `email:${input.invoiceId}:${new Date(now()).toISOString().slice(0, 10)}`;
  const status = await deps.outbox.queue({ key, to: input.email, subject: message.subject, body: message.body, label: EMAIL_LABEL,
    ...(message.withLink ? { linkId: input.payLink!.id } : {}) });
  await audit(status === 'queued' ? 'email_followup_queued' : 'email_followup_duplicate', { decision: 'ALLOW', ruleIds,
    inputs: { channel: 'email', simulated: true, label: EMAIL_LABEL, toDomain: domain, withLink: message.withLink,
      ...(message.withLink ? { linkId: input.payLink!.id } : {}), key } });
  return { status, key, withLink: message.withLink, ruleIds };
}

/** The same context with the email-only refusals (consent, consumer, opt-out) cleared, so only the window check remains. */
function windowProbe(context: Context): Context {
  const client = context.client;
  const number = client?.phoneNumber || 'email-only';
  return { ...context, client: { ...client, type: 'business', dnc: false, phoneNumber: number,
    consent: { source: 'email-window-check', text: 'window check only', timestamp: '1970-01-01T00:00:00Z', number } } as NonNullable<Context['client']> };
}
