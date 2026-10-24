import { afterEach, expect, it, vi } from 'vitest';
import { runApprovalExpiry } from './approval-expiry';

afterEach(() => vi.unstubAllGlobals());

it('expires a live call at the approval window with one re-ask, and closes a no-callId row at 60s', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runApprovalExpiry();
  expect(run.live.windowMs).toBeGreaterThan(60_000);
  expect(run.live.storedCallId).toBe('approval-demo');
  expect(run.live.storedWindow).toBe(run.live.windowMs);
  expect(run.live.voice).toEqual({ decide: 200, check: 400, decideKind: 'ESCALATE', decideCanConfirm: false, decideRules: ['UNRECOGNIZED_REQUEST'] });
  expect(run.live.atSixty).toMatchObject({ approval_status: 'pending', can_confirm: false });
  expect(run.live.expiredAuditsAtSixty).toBe(0);
  expect(run.live.atWindowMinus).toMatchObject({ approval_status: 'pending', can_confirm: false });
  expect(run.live.expiredAuditsBeforeWindow).toBe(0);
  expect(run.live.atWindow).toMatchObject({ approval_status: 'expired', may_reask: true, can_confirm: false });
  expect(run.live.serviceAtWindow).toBe('expired');
  expect(run.live.expiredAuditsAtWindow).toBe(1);
  expect(run.live.latePasskeyError).toBe('ESCALATION_CLOSED');
  expect(run.live.afterDecide).toEqual({ status: 'expired', method: null });
  expect(run.live.decideAudits).toBe(0);
  expect(run.live.fresh).toMatchObject({ kind: 'ESCALATE', can_confirm: false });
  expect(run.live.fresh.escalation_id).not.toBe(run.live.firstId);
  expect(run.live.createdAfterFresh).toBe(2);
  expect(run.live.open).toMatchObject({ kind: 'DENY', rule_ids: ['ESCALATION_OPEN'], can_confirm: false });
  expect(run.live.createdAfterOpen).toBe(2);
  expect(run.live.secondClosed).toMatchObject({ approval_status: 'expired', may_reask: false, can_confirm: false });
  expect(run.live.retry).toMatchObject({ kind: 'DENY', rule_ids: ['ESCALATION_RETRY_USED'], can_confirm: false });
  expect(run.live.createdAfterRetry).toBe(2);
  expect(run.owner.callId).toBeNull();
  expect(run.owner.windowMs).toBe(60_000);
  expect(run.owner.before).toEqual({ status: 'pending', callId: null });
  expect(run.owner.unread).toEqual({ status: 'pending', callId: null });
  expect(run.owner.closed).toEqual({ status: 'pending_owner', callId: null });
  expect(run.checks).toEqual(Object.fromEntries(Object.keys(run.checks).map(key => [key, true])));
});
