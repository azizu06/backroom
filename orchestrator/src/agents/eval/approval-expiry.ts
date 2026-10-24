/** Live-call approval expiry (PR #210) through ControllerApprovals and the voice tool gateway. */
import { evaluate } from '@backroom/policy';
import { approvalWindowMs, ControllerApprovals, MemoryStateStore } from '@backroom/orchestrator';
import { TestAuthenticator } from '../../approvals/testing/authenticator';
import { createApprovalBridge } from '../../../../web/lib/approvals/gateway';
import { approvalDemoCall } from '../../../../web/lib/approvals/testing/call';
import { createGateway } from '../../../../web/lib/gateway/http';
import { MemoryGatewayStore } from '../../../../web/lib/gateway/store';

const origin = 'http://localhost:3020';
const plan = { installments: 4, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 };
type ToolView = {
  kind?: string; rule_ids?: string[]; escalation_id?: string; can_confirm?: boolean;
  approval_status?: string; may_reask?: boolean;
};

function clock() {
  let now = 1_000;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

async function liveCall() {
  const time = clock();
  const state = new MemoryStateStore();
  const service = new ControllerApprovals(state, { origin, rpID: 'localhost', enrollmentSecret: 'offline-eval-only' }, time.now);
  const auth = new TestAuthenticator();
  const enrolled = await service.registrationOptions('offline-eval-only');
  await service.register('offline-eval-only', enrolled.challengeId, auth.registration(enrolled.options.challenge));
  const gateway = createGateway({ secret: () => 'offline-eval-tool', store: new MemoryGatewayStore([approvalDemoCall()], state),
    approvalBridge: createApprovalBridge(state, time.now) });
  let seq = 0;
  const tool = async (name: string, fields: Record<string, unknown> = {}) => {
    const response = await gateway(name, new Request(`${origin}/api/tools/${name}`, {
      method: 'POST', headers: { authorization: 'Bearer offline-eval-tool', 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_id: 'approval-demo', webhook_request_id: `expiry-${++seq}`, ...fields }),
    }));
    return { status: response.status, body: await response.json() as ToolView };
  };
  const audits = async (action: string) => (await state.listAudit()).filter(entry => entry.action === action).length;
  const voiceDecide = await tool('decide_escalation', { decision: 'Approve' });
  const voiceCheck = await tool('check_approval', { escalation_id: 'fake', method: 'passkey', approved: true });
  const first = await tool('propose_plan', plan);
  const firstId = first.body.escalation_id ?? null;
  const stored = firstId ? await state.getEscalation(firstId) : undefined;
  const windowMs = approvalWindowMs();
  time.advance(60_000);
  const atSixty = firstId ? (await tool('check_approval', { escalation_id: firstId })).body : {};
  const expiredAuditsAtSixty = await audits('escalation_expired');
  const span = windowMs - 60_000 - 1;
  if (span > 0) time.advance(span);
  const atWindowMinus = firstId ? (await tool('check_approval', { escalation_id: firstId })).body : {};
  const expiredAuditsBeforeWindow = await audits('escalation_expired');
  const challenge = firstId && atWindowMinus.approval_status === 'pending'
    ? await service.decisionOptions(firstId, { kind: 'Approve' }) : undefined;
  time.advance(1);
  const atWindow = firstId ? (await tool('check_approval', { escalation_id: firstId })).body : {};
  const serviceAtWindow = firstId ? (await service.get(firstId)).status : 'missing';
  const expiredAuditsAtWindow = await audits('escalation_expired');
  let latePasskeyError = 'NOT_ATTEMPTED';
  if (challenge && firstId) {
    try { await service.decide(firstId, challenge.challengeId, auth.assertion(challenge.options.challenge)); latePasskeyError = 'ACCEPTED'; }
    catch (error) { latePasskeyError = error instanceof Error ? error.message : 'ERROR'; }
  }
  const decided = firstId ? await state.getEscalation(firstId) : undefined;
  const fresh = await tool('propose_plan', plan);
  const createdAfterFresh = await audits('create_escalation');
  const open = await tool('propose_plan', plan);
  const createdAfterOpen = await audits('create_escalation');
  time.advance(windowMs);
  const secondId = fresh.body.escalation_id;
  const secondClosed = secondId ? (await tool('check_approval', { escalation_id: secondId })).body : {};
  const retry = await tool('propose_plan', plan);
  return {
    windowMs, firstId, storedCallId: stored?.callId ?? null, storedWindow: stored ? stored.expiresAt - stored.createdAt : null,
    voice: { decide: voiceDecide.status, check: voiceCheck.status },
    atSixty, expiredAuditsAtSixty, atWindowMinus, expiredAuditsBeforeWindow, atWindow, serviceAtWindow, expiredAuditsAtWindow,
    latePasskeyError, afterDecide: { status: decided?.status ?? 'missing', method: decided?.method ?? null },
    fresh: fresh.body, createdAfterFresh, open: open.body, createdAfterOpen, secondClosed, retry: retry.body,
    createdAfterRetry: await audits('create_escalation'), decideAudits: await audits('decide_escalation'),
  };
}

async function ownerRow() {
  const time = clock();
  const state = new MemoryStateStore();
  const service = new ControllerApprovals(state, { origin, rpID: 'localhost', enrollmentSecret: 'offline-eval-only' }, time.now);
  await state.registerAgent('worker', 'collections', time.now());
  await state.enqueueTask({ id: 'owner-window', seatId: 'collections', refs: ['1042'], steps: [] });
  const lease = await state.claimTask('worker', time.now(), 120_000);
  if (!lease) throw new Error('OWNER_LEASE_REQUIRED');
  const decision = evaluate('collections', { type: 'propose_plan', plan: { installments: 4, firstPaymentPct: 50, totalDays: 30, waiveFees: false, discountPct: 0 } }, { identityConfirmed: true });
  if (decision.kind !== 'ESCALATE') throw new Error('OWNER_ESCALATION_REQUIRED');
  const created = await state.createEscalation(lease, decision, time.now());
  time.advance(59_999);
  const before = await service.get(created.id);
  time.advance(1);
  const unread = await state.getEscalation(created.id);
  const closed = await service.get(created.id);
  return {
    callId: created.callId ?? null, windowMs: created.expiresAt - created.createdAt,
    before: { status: before.status, callId: before.callId ?? null },
    unread: { status: unread?.status ?? 'missing', callId: unread?.callId ?? null },
    closed: { status: closed.status, callId: closed.callId ?? null },
  };
}

export async function runApprovalExpiry() {
  const live = await liveCall();
  const owner = await ownerRow();
  const checks = {
    pendingAtSixtySeconds: live.atSixty.approval_status === 'pending' && live.atSixty.can_confirm === false && live.expiredAuditsAtSixty === 0,
    pendingUntilWindow: live.atWindowMinus.approval_status === 'pending' && live.atWindowMinus.can_confirm === false && live.expiredAuditsBeforeWindow === 0 && live.windowMs > 60_000,
    expiredAtWindow: live.atWindow.approval_status === 'expired' && live.atWindow.may_reask === true && live.atWindow.can_confirm === false
      && live.serviceAtWindow === 'expired' && live.expiredAuditsAtWindow === 1 && live.storedCallId === 'approval-demo' && live.storedWindow === live.windowMs,
    oneFreshEscalation: live.fresh.kind === 'ESCALATE' && live.fresh.can_confirm === false && typeof live.fresh.escalation_id === 'string'
      && live.fresh.escalation_id !== live.firstId && live.createdAfterFresh === 2,
    escalationOpen: live.open.kind === 'DENY' && JSON.stringify(live.open.rule_ids) === '["ESCALATION_OPEN"]' && live.open.can_confirm === false && live.createdAfterOpen === 2,
    secondMayNotReask: live.secondClosed.approval_status === 'expired' && live.secondClosed.may_reask === false && live.secondClosed.can_confirm === false,
    escalationRetryUsed: live.retry.kind === 'DENY' && JSON.stringify(live.retry.rule_ids) === '["ESCALATION_RETRY_USED"]' && live.retry.can_confirm === false && live.createdAfterRetry === 2,
    latePasskeyRejected: live.latePasskeyError === 'ESCALATION_CLOSED' && live.afterDecide.status === 'expired' && live.afterDecide.method === null,
    noDecideAudit: live.decideAudits === 0,
    voiceCannotApprove: live.voice.decide === 404 && live.voice.check === 400,
    noCallId: owner.callId === null && owner.windowMs === 60_000,
    pendingBeforeSixtySeconds: owner.before.status === 'pending' && owner.before.callId === null,
    pendingOwnerAtSixtySeconds: owner.unread.status === 'pending' && owner.closed.status === 'pending_owner' && owner.closed.callId === null,
  };
  return { id: 'approval-expiry', match: Object.values(checks).every(Boolean), checks, live, owner,
    scope: 'Production ControllerApprovals with an injected clock, and createGateway + createApprovalBridge + MemoryGatewayStore on a synthetic call. A live escalation stays pending at 60s and becomes expired with may_reask at approvalWindowMs(); the same terms open one fresh escalation, a second open re-ask is ESCALATION_OPEN, and after that expires another propose_plan is ESCALATION_RETRY_USED. A still-valid passkey decide after expiry is rejected with no decide_escalation audit; voice cannot approve. A worker row with no callId stays pending through 59.999s and closes at 60s as pending_owner when ControllerApprovals reads it. Software passkey and fixture call only; Cartesia, email, phone, and a human tap are not executed.' };
}
