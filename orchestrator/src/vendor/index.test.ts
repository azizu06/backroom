import { describe, expect, it, vi } from 'vitest';
import { MemoryStateStore } from '../store';
import { controllerForLease } from '../payables';
import { ControllerApprovals, type ControllerDecision } from '../approvals';
import { TestAuthenticator } from '../approvals/testing/authenticator';
import { VendorSeat } from './index';

import { createNorthfieldRepository, northfieldChange, northfieldInvoice, northfieldVendor } from '../payables/northfield';

const vendor = northfieldVendor('cedar');
const { fields: change, source } = northfieldChange('bc-legitimate');
async function setup() {
  let now = 1000;
  const state = new MemoryStateStore();
  const approvals = new ControllerApprovals(state, { origin: 'http://localhost:3020', rpID: 'localhost', enrollmentSecret: 'test-enrollment' }, () => now);
  const auth = new TestAuthenticator();
  const enrollment = await approvals.registrationOptions('test-enrollment');
  await approvals.register('test-enrollment', enrollment.challengeId, auth.registration(enrollment.options.challenge));
  const decide = async (id: string, decision: ControllerDecision = { kind: 'Approve' }) => {
    const challenge = await approvals.decisionOptions(id, decision);
    return approvals.decide(id, challenge.challengeId, auth.assertion(challenge.options.challenge));
  };
  await state.registerAgent('vendor-seat', 'vendor_onboarding', 1000);
  await state.enqueueTask({ id: 'task-1', seatId: 'vendor_onboarding', refs: [source.id, 'resent-invoice-4480'], steps: [] });
  const lease = (await state.claimTask('vendor-seat', 1000, 12000))!;
  const checks = {
    business: vi.fn(async () => ({ verified: true, evidenceRef: 'crs-business-1' })),
    ofac: vi.fn(async () => ({ status: 'clear' as 'clear' | 'hit' | 'unknown', evidenceRef: 'crs-ofac-1' })),
    footprint: vi.fn(async () => ({ websiteReachable: true, listingOperating: true, domain: vendor.domain, evidenceRef: 'apify-1' })),
  };
  const repository = await createNorthfieldRepository();
  const seat = new VendorSeat({ state, repository, checks, controller: controllerForLease(state, lease, () => now), now: () => now });
  return { seat, state, repository, checks, decide, advance: (ms: number) => { now += ms; } };
}
describe('Vendor verification and controller gate', () => {
  it('keeps a legitimate change pending until a controller passkey decision, then applies once', async () => {
    const { seat, state, repository, decide } = await setup();
    const proposal = await seat.propose(change, source);
    expect(proposal.status).toBe('awaiting_controller');
    expect((await state.getAgent('vendor-seat'))?.targetAnchor).toBe('Dana_desk');
    expect((await repository.getVendor(vendor.id))?.accountId).toBe('bank-master:cedar');
    expect((await seat.apply(source.id)).status).toBe('awaiting_controller');
    await decide(proposal.escalationId!);
    expect((await seat.apply(source.id)).status).toBe('approved');
    expect((await repository.getVendor(vendor.id))?.accountId).toBe('SYNTHETIC-CEDAR-8822');
    expect((await seat.apply(source.id)).status).toBe('approved');
    expect((await repository.getVendor(vendor.id))?.revision).toBe(2);
  });
  it.each(['hit', 'unknown'] as const)('never verifies an OFAC %s', async status => {
    const { seat, checks, repository } = await setup();
    checks.ofac.mockResolvedValue({ status, evidenceRef: 'crs-ofac-1' });
    const result = await seat.propose(change, source);
    expect(result.status).toBe(status === 'hit' ? 'rejected' : 'held');
    expect(result.decision.ruleIds).toContain(status === 'hit' ? 'OFAC_STOP' : 'INVALID_INPUT');
    expect((await repository.getVendor(vendor.id))?.accountId).toBe('bank-master:cedar');
  });
  it('holds a vendor with no footprint and rejects a lookalike without trusting its proposed domain', async () => {
    const { seat, checks } = await setup();
    checks.footprint.mockResolvedValue({ websiteReachable: false, listingOperating: false, domain: vendor.domain, evidenceRef: 'apify-1' });
    expect((await seat.propose(change, source)).status).toBe('held');
    const other = await setup();
    expect((await other.seat.propose({ ...change, domain: 'cedarfre1ght.example' }, { ...source, senderDomain: 'cedarfre1ght.example' })).decision.ruleIds).toContain('LOOKALIKE_DOMAIN');
  });
});

it('cannot pay the new account before approval; the held invoice pays after master application', async () => {
  const { seat, state, repository, decide } = await setup();
  const { PayablesSeat } = await import('../payables');
  const pay = vi.fn(async () => ({ status: 'completed' as const, id: 'receipt-1' }));
  const ap = new PayablesSeat({ repository, state, nessie: { payInvoice: pay }, controller: { request: async () => 'ap-hold' } });
  const invoice = northfieldInvoice('4480');
  expect((await ap.process(invoice, { ...source, id: 'invoice-1' })).status).toBe('held');
  expect(pay).not.toHaveBeenCalled();
  const proposal = await seat.propose(change, source);
  await decide(proposal.escalationId!);
  await seat.apply(source.id);
  expect((await ap.process(invoice, { ...source, id: 'invoice-1' })).status).toBe('paid');
  expect(pay.mock.calls).toHaveLength(1);
});
it('does not accept an unbound or passkey-less controller approval', async () => {
  const { seat, state, repository, decide } = await setup();
  const proposal = await seat.propose(change, source);
  const pending = (await state.getEscalation(proposal.escalationId!))!;
  const get = vi.spyOn(state, 'getEscalation');
  get.mockResolvedValue({ ...pending, status: 'approved', decidedAt: 1001 });
  expect((await seat.apply(source.id)).status).toBe('awaiting_controller');
  get.mockResolvedValue({ ...pending, status: 'approved', method: 'passkey', decidedAt: 1001, evidenceRefs: ['unrelated'] });
  expect((await seat.apply(source.id)).status).toBe('awaiting_controller');
  expect((await repository.getVendor(vendor.id))?.accountId).toBe('bank-master:cedar');
});
it('does not apply a denial or an approval based on a stale master revision', async () => {
  for (const denied of [true, false]) {
    const { seat, state, repository, decide } = await setup();
    const proposal = await seat.propose(change, source);
    await decide(proposal.escalationId!, { kind: denied ? 'Deny' : 'Approve' });
    if (!denied) await repository.saveVendor({ ...vendor, revision: 2 });
    expect((await seat.apply(source.id)).status).toBe(denied ? 'rejected' : 'held');
    expect((await repository.getVendor(vendor.id))?.accountId).toBe('bank-master:cedar');
  }
});
it('proposes a new verified vendor but adds it to the master only after approval', async () => {
  const { seat, state, repository, decide } = await setup();
  const newVendor = { ...change, kind: 'vendor' as const, vendorId: 'new-vendor' };
  const proposal = await seat.propose(newVendor, source);
  expect(proposal.status).toBe('awaiting_controller');
  expect(await repository.getVendor('new-vendor')).toBeUndefined();
  await decide(proposal.escalationId!);
  expect((await seat.apply(source.id)).status).toBe('approved');
  expect((await repository.getVendor('new-vendor'))?.approved).toBe(true);
});
it('persists an immutable proposal before requesting approval, and recovers a lost escalation response', async () => {
  const { state, repository, checks } = await setup();
  const pending = { id: 'esc-immutable', taskId: 'task-1', fromAgent: 'vendor-seat', toHuman: 'Dana', ruleIds: ['BANK_CHANGE_HOLD'], evidenceRefs: [source.id], status: 'pending' as const };
  const request = vi.fn().mockRejectedValueOnce(new Error('lost escalation response')).mockResolvedValue(pending.id);
  const seat = new VendorSeat({ state, repository, checks, controller: { request } });
  await expect(seat.propose(change, source)).rejects.toThrow('lost escalation response');
  expect((await repository.getBankChange(source.id))?.fields.bankAccountId).toBe('SYNTHETIC-CEDAR-8822');
  await expect(seat.propose({ ...change, bankAccountId: 'substituted-account' }, source)).rejects.toThrow('PROPOSAL_ID_CONFLICT');
  expect((await seat.propose(change, source)).escalationId).toBe(pending.id);
  expect(request).toHaveBeenCalledTimes(2);
});
it('holds payments to the old master account while a bank change awaits the controller', async () => {
  const { seat, state, repository, decide } = await setup();
  await seat.propose(change, source);
  const { PayablesSeat } = await import('../payables');
  const pay = vi.fn(async () => ({ status: 'completed' as const, id: 'receipt-1' }));
  const ap = new PayablesSeat({ repository, state, nessie: { payInvoice: pay }, controller: { request: async () => 'ap-hold' } });
  const result = await ap.process({ ...northfieldInvoice('4480'), bankAccountId: vendor.accountId }, { ...source, id: 'invoice-1' });
  expect(result.decision.ruleIds).toContain('BANK_CHANGE_HOLD');
  expect(pay).not.toHaveBeenCalled();
});
it.each(['Counter', 'timeout'] as const)('holds the bank change on the shared controller %s outcome', async outcome => {
  const { seat, repository, state, decide, advance } = await setup();
  const proposal = await seat.propose(change, source);
  if (outcome === 'Counter') {
    await decide(proposal.escalationId!, { kind: 'Counter', terms: { installments: 2, firstPaymentPct: 50, durationDays: 30, waiveFee: false, discountPct: 0 } });
  } else advance(60000);
  expect((await seat.apply(source.id)).status).toBe('held');
  expect((await state.getEscalation(proposal.escalationId!))?.status).toBe(outcome === 'Counter' ? 'counter' : 'pending_owner');
  expect((await repository.getVendor(vendor.id))?.accountId).toBe('bank-master:cedar');
});

it('recognizes the applied bank account on a resent inbox message without reopening approval', async () => {
  const { seat, repository, decide, state, checks } = await setup();
  const proposal = await seat.propose(change, source);
  // A different source ID before approval is still a hold, never a no-op approval.
  expect((await repository.getVendor(vendor.id))?.accountId).not.toBe(change.bankAccountId);
  await decide(proposal.escalationId!);
  await seat.apply(source.id);
  const priorChecks = checks.business.mock.calls.length;
  const result = await seat.propose(change, { ...source, id: 'resent-invoice-4480' });
  expect(result.status).toBe('approved');
  expect(result.decision.kind).toBe('ALLOW');
  expect(await repository.hasPendingBankChange(vendor.id)).toBe(false);
  expect((await repository.getVendor(vendor.id))?.revision).toBe(2);
  expect(checks.business).toHaveBeenCalledTimes(priorChecks);
  expect((await state.listAudit()).at(-1)?.action).toBe('bank_change_already_applied');
});

it.each(['sender', 'field-domain', 'pending', 'sanctioned'] as const)('does not recognize an applied account as approved when %s evidence differs', async mismatch => {
  const { seat, repository, decide } = await setup();
  const proposal = await seat.propose(change, source);
  await decide(proposal.escalationId!); await seat.apply(source.id);
  const current = (await repository.getVendor(vendor.id))!;
  if (mismatch === 'pending') await repository.saveVendor({ ...current, pendingBankChange: true });
  if (mismatch === 'sanctioned') await repository.saveVendor({ ...current, ofacHit: true });
  const fields = mismatch === 'field-domain' ? { ...change, domain: 'cedarfre1ght.example' } : change;
  const envelope = { ...source, id: 'resent-invoice-4480', ...(mismatch === 'sender' && { senderDomain: 'cedarfre1ght.example' }) };
  expect((await seat.propose(fields, envelope)).decision.kind).not.toBe('ALLOW');
  expect((await repository.getVendor(vendor.id))?.revision).toBe(2);
});
