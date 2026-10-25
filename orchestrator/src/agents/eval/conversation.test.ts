import { afterEach, expect, it, vi } from 'vitest';
import { CONVERSATIONS, runConversation } from './conversation';

afterEach(() => vi.unstubAllGlobals());

it.each(CONVERSATIONS)('%s: scripted call through the gateway, then the Dispatcher, matches the key outcome', async name => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runConversation(name);
  expect(run.checks).toEqual(Object.fromEntries(Object.keys(run.checks).map(key => [key, true])));
  expect(run.match).toBe(true);
});

it('without the host-declared pairing the Reconciler refuses under the Dispatcher (pre-fix behaviour)', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runConversation('already_paid_matched', { pairing: false });
  expect(run.roles).toEqual(['collections']);
  expect(run).toMatchObject({ caseStatus: 'held', reason: 'RECONCILIATION_CASE_MISMATCH' });
  expect(run.cleared).toBe(false);
  expect(run.match).toBe(false);
});

it('C09 records the queued human request and both production escalation receipts without grading callback speech', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runConversation('human_request');
  expect(run.humanFollowup).toEqual({
    queuedRequests: 1,
    gatewayEscalations: [{ decision: 'ESCALATE', ruleIds: ['REQUEST_HUMAN'] }],
    mirroredEscalations: [{ decision: 'ESCALATE', ruleIds: ['REQUEST_HUMAN'] }],
    postcallEscalations: [{ decision: 'ESCALATE', ruleIds: ['CALL_HUMAN_REQUESTED'] }],
    gatewayReviewRecipients: [],
  });
  expect(run.checks.humanFollowupQueued).toBe(true);
  expect(run.checks.humanEscalationMirrored).toBe(true);
  expect(run.match).toBe(true);
});

it('C21 retains the identity-denied voicemail probe without claiming a callback was spoken or delivered', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runConversation('voicemail');
  expect(run.voicemailEvidence).toEqual({ gatewayReplyKinds: ['DENY'],
    invoiceReadRefused: true, callbackInstructionConfigured: true, speechMeasured: false, messageDelivered: false });
  expect(run.checks.noLeakBeforeIdentity).toBe(true);
  expect(run.checks.nextCallAllowed).toBe(true);
});

it('the pre-identity leak check catches the amount in any spoken format, and invoice fields', async () => {
  const { revealsInvoice } = await import('./conversation');
  const deny = { kind: 'DENY', can_confirm: false, rule_ids: ['IDENTITY_REQUIRED'], speak: 'Please confirm I am speaking with the intended contact first.' };
  expect(revealsInvoice(deny, 495000)).toBe(false);
  for (const speak of ['You owe 495000 cents', 'You owe $4,950.00', 'about 4950 dollars', 'total 4950.00']) {
    expect(revealsInvoice({ ...deny, speak }, 495000)).toBe(true);
  }
  expect(revealsInvoice({ ...deny, invoice_id: '1042' }, 495000)).toBe(true);
});
