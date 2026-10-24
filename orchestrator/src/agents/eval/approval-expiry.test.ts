import { afterEach, expect, it, vi } from 'vitest';
import { runApprovalExpiry } from './approval-expiry';

afterEach(() => vi.unstubAllGlobals());

it('measures live-call approval expiry, one re-escalation, and the no-callId 60s close', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runApprovalExpiry();
  expect(run.match).toBe(true);
  expect(run.checks).toEqual({
    livePendingAt60s: true,
    expiredWithMayReask: true,
    oneFreshEscalation: true,
    openRetryDenied: true,
    secondMayNotReask: true,
    retryUsedDenied: true,
    passkeyAfterExpiryRejected: true,
    voiceCannotApprove: true,
    noCallIdPendingOwner: true,
  });
  expect(run.live.at60s).toMatchObject({ approval_status: 'pending', can_confirm: false });
  expect(run.live.atWindow).toMatchObject({ approval_status: 'expired', may_reask: true, can_confirm: false });
  expect(run.live.reask).toMatchObject({ kind: 'ESCALATE', can_confirm: false });
  expect(run.live.reask.escalation_id).not.toBe(run.live.firstId);
  expect(run.createAudits).toBe(3);
  expect(run.live.openDeny).toMatchObject({ kind: 'DENY', rule_ids: ['ESCALATION_OPEN'], can_confirm: false });
  expect(run.live.afterSecond).toMatchObject({ approval_status: 'expired', may_reask: false, can_confirm: false });
  expect(run.live.retryUsed).toMatchObject({ kind: 'DENY', rule_ids: ['ESCALATION_RETRY_USED'], can_confirm: false });
  expect(run.passkeyError).toBe('ESCALATION_CLOSED');
  expect(run.decideAudits).toBe(0);
  expect(run.voiceStatus).toBe(404);
  expect(run.forgedStatus).toBe(400);
  expect(run.noCallId.callId).toBeNull();
  expect(run.noCallId.expiresAt - run.noCallId.createdAt).toBe(60_000);
  expect(run.noCallId.statusBefore60s).toBe('pending');
  expect(run.noCallId.statusAt60s).toBe('pending_owner');
});
