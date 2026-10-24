/** Offline measurement of the live-call approval window from PR #210.
 * ControllerApprovals uses an injected clock. propose_plan / check_approval go through
 * createGateway + createApprovalBridge + MemoryGatewayStore, the same boundary as
 * web/lib/approvals/http.test.ts. No dial, model, or network. */
import { approvalWindowMs, ControllerApprovals, MemoryStateStore } from '@backroom/orchestrator';
import { TestAuthenticator } from '../../approvals/testing/authenticator';
import { createApprovalBridge } from '../../../../web/lib/approvals/gateway';
import { approvalDemoCall } from '../../../../web/lib/approvals/testing/call';
import { createGateway } from '../../../../web/lib/gateway/http';
import { MemoryGatewayStore } from '../../../../web/lib/gateway/store';

const origin = 'http://localhost:3020';
const plan = { installments: 4, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 };
type ToolBody = {
  kind?: string; approval_status?: string; may_reask?: boolean; can_confirm?: boolean;
  escalation_id?: string; rule_ids?: string[]; speak?: string; error?: string;
};

export async function runApprovalExpiry() {
  const windowMs = approvalWindowMs();
  const state = new MemoryStateStore();
  let now = 1_000;
  const service = new ControllerApprovals(state, {
    origin, rpID: 'localhost', enrollmentSecret: 'offline-eval-only',
  }, () => now);
  const authenticator = new TestAuthenticator();
  const enrollment = await service.registrationOptions('offline-eval-only');
  await service.register('offline-eval-only', enrollment.challengeId, authenticator.registration(enrollment.options.challenge));
  const gateway = createGateway({
    secret: () => 'offline-eval-tool',
    store: new MemoryGatewayStore([approvalDemoCall()], state),
    approvalBridge: createApprovalBridge(state, () => now),
  });
  let seq = 0;
  const tool = async (name: string, fields: Record<string, unknown> = {}) => {
    const response = await gateway(name, new Request(`${origin}/api/tools/${name}`, {
      method: 'POST',
      headers: { authorization: 'Bearer offline-eval-tool', 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_id: 'approval-demo', webhook_request_id: `expiry-${++seq}`, ...fields }),
    }));
    return { status: response.status, body: await response.json() as ToolBody };
  };
  const created = await state.createCallEscalation({
    id: 'no-call-window', taskId: 'no-call-window', fromAgent: 'collections-worker', toHuman: 'Dana',
    seat: 'collections', ruleIds: ['MAX_INSTALLMENTS'], evidenceRefs: ['audit:offline', '1042'],
    invoiceId: '1042', policyVersion: 1, quote: { sentenceId: 'NF-005', text: 'At most two installments.' },
    amountCents: 495000, principalCents: 480000, lateFeeCents: 15000, currency: 'USD',
    requestedTerms: { installments: 4, firstPaymentPct: 50, durationDays: 30, waiveFee: false, discountPct: 0 },
  }, now);
  const first = await tool('propose_plan', plan);
  const firstId = first.body.escalation_id ?? '';
  const advance = (ms: number) => { now += ms; };
  advance(60_000 - 1);
  const liveBefore60 = await tool('check_approval', { escalation_id: firstId });
  const noCallBefore60 = await service.get(created.id);
  advance(1);
  const liveAt60 = await tool('check_approval', { escalation_id: firstId });
  const noCallAt60 = await service.get(created.id);
  // The passkey challenge itself lasts 60s. Mint it inside that TTL and still before the call window,
  // so a rejection is the closed escalation and not an already-spent challenge.
  advance(windowMs - 60_000 - 30_000);
  const pendingBeforeWindow = await service.get(firstId);
  const challenge = await service.decisionOptions(firstId, { kind: 'Approve' });
  advance(30_000);
  const expired = await tool('check_approval', { escalation_id: firstId });
  let passkeyError = 'ACCEPTED';
  try {
    await service.decide(firstId, challenge.challengeId, authenticator.assertion(challenge.options.challenge));
  } catch (error) {
    passkeyError = error instanceof Error ? error.message : 'ERROR';
  }
  const afterPasskey = await service.get(firstId);
  const reask = await tool('propose_plan', plan);
  const openDeny = await tool('propose_plan', plan);
  advance(windowMs);
  const secondId = reask.body.escalation_id ?? '';
  const afterSecond = await tool('check_approval', { escalation_id: secondId });
  const retryUsed = await tool('propose_plan', plan);
  const voice = await tool('decide_escalation', { decision: 'Approve' });
  const forged = await tool('check_approval', { escalation_id: firstId, approved: true, method: 'passkey' });
  const audits = await state.listAudit();
  const decideAudits = audits.filter(entry => entry.action === 'decide_escalation').length;
  const createAudits = audits.filter(entry => entry.action === 'create_escalation').length;
  const checks = {
    livePendingAt60s: liveBefore60.body.approval_status === 'pending' && liveAt60.body.approval_status === 'pending' && liveAt60.body.can_confirm === false,
    expiredWithMayReask: pendingBeforeWindow.status === 'pending' && expired.body.approval_status === 'expired' && expired.body.may_reask === true && expired.body.can_confirm === false,
    oneFreshEscalation: reask.body.kind === 'ESCALATE' && reask.body.can_confirm === false && secondId !== '' && secondId !== firstId && createAudits === 3,
    openRetryDenied: openDeny.body.kind === 'DENY' && JSON.stringify(openDeny.body.rule_ids) === JSON.stringify(['ESCALATION_OPEN']) && openDeny.body.can_confirm === false,
    secondMayNotReask: afterSecond.body.approval_status === 'expired' && afterSecond.body.may_reask === false && afterSecond.body.can_confirm === false,
    retryUsedDenied: retryUsed.body.kind === 'DENY' && JSON.stringify(retryUsed.body.rule_ids) === JSON.stringify(['ESCALATION_RETRY_USED']) && retryUsed.body.can_confirm === false,
    passkeyAfterExpiryRejected: passkeyError === 'ESCALATION_CLOSED' && afterPasskey.status === 'expired' && afterPasskey.method === undefined,
    voiceCannotApprove: voice.status === 404 && forged.status === 400 && decideAudits === 0,
    noCallIdPendingOwner: created.callId === undefined && created.expiresAt - created.createdAt === 60_000
      && noCallBefore60.status === 'pending' && noCallAt60.status === 'pending_owner',
  };
  return {
    match: Object.values(checks).every(Boolean), checks, windowMs, passkeyError, decideAudits, createAudits,
    voiceStatus: voice.status, forgedStatus: forged.status,
    live: {
      firstId, at60s: liveAt60.body, atWindow: expired.body, reask: reask.body, openDeny: openDeny.body,
      afterSecond: afterSecond.body, retryUsed: retryUsed.body,
    },
    noCallId: { id: created.id, callId: created.callId ?? null, createdAt: created.createdAt, expiresAt: created.expiresAt,
      statusBefore60s: noCallBefore60.status, statusAt60s: noCallAt60.status },
    scope: 'ControllerApprovals with an injected clock, and createGateway + createApprovalBridge + MemoryGatewayStore. A live call stays pending at 60s and returns approval_status expired with may_reask true at approvalWindowMs(); the same terms open one fresh escalation, a second open re-ask is ESCALATION_OPEN, and after that expiry may_reask is false and propose_plan is ESCALATION_RETRY_USED. A still-valid passkey assertion after expiry is rejected. decide_escalation is not a gateway tool and writes no decide_escalation audit. A row with no callId closes at 60s as pending_owner. No dial, model, or network.',
  };
}
