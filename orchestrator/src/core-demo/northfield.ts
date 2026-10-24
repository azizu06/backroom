/** Offline AP proof on the frozen company. Sponsor checks and bank debits are explicit fakes. */
import type { Decision } from '@backroom/policy';
import expected from '../../../fixtures/answer-key/expected.json';
import { MemoryStateStore } from '../store';
import { ControllerApprovals } from '../approvals';
import { TestAuthenticator } from '../approvals/testing/authenticator';
import { PayablesSeat, controllerForLease, createNorthfieldRepository, northfield, northfieldChange,
  northfieldInvoice, northfieldSource, northfieldVendor, type PayablesClient } from '../payables';
import { VendorSeat } from '../vendor';
import { reconcile } from './bank';

export async function runNorthfieldPayables() {
  const now = Date.parse(northfield.snapshotAt);
  const state = new MemoryStateStore();
  const repository = await createNorthfieldRepository();
  const payments: Parameters<PayablesClient['payInvoice']>[0][] = [];
  const ap = new PayablesSeat({ repository, state, now: () => now,
    controller: { request: (decision, refs) => request('payables', decision, refs) },
    nessie: { async payInvoice(input) {
      // Assert the #60 invariant at the final mocked transport, independently of input fields.
      const master = await repository.getVendor(input.vendorId);
      if (!master?.approved || master.ofacHit || input.destinationAccountId !== master.accountId ||
        await repository.hasPendingBankChange(input.vendorId)) throw new Error('CORE_DEMO: non-master payment');
      payments.push(input);
      return { id: `mock-ap:${input.invoiceId}`, status: 'completed' };
    } } });
  let taskNumber = 0;
  async function claim(seat: 'payables' | 'vendor_onboarding', refs: string[]) {
    const id = `seed-task:${++taskNumber}`;
    await state.registerAgent(id, seat, now);
    await state.enqueueTask({ id, seatId: seat, refs, steps: [] });
    return (await state.claimTask(id, now, 12000))!;
  }
  async function request(seat: 'payables' | 'vendor_onboarding', decision: Extract<Decision, { kind: 'ESCALATE' }>, refs: string[]) {
    const lease = await claim(seat, refs);
    const id = await controllerForLease(state, lease, () => now).request(decision, refs);
    // This task records the escalation; the separate controller workflow remains pending.
    await state.completeTask(lease, 'done', now);
    return id;
  }
  const results = [];
  // P02 explicitly resets the independent bank-change trap in the frozen scenario.
  for (const [scenario, invoiceId] of [['P01', '4401'], ['P02', '4419'], ['P03', '4471'],
    ['P05', '4481'], ['P06', '4482'], ['P07', '4483'], ['P09', '4485']] as const) {
    if (scenario === 'P02') await repository.saveVendor({ ...northfieldVendor('acme'), pendingBankChange: false });
    if (scenario === 'P03') await repository.saveVendor(northfieldVendor('acme'));
    const result = await ap.process(northfieldInvoice(invoiceId), northfieldSource(invoiceId));
    const answer = expected.payables[scenario].expectedSteps[0]!;
    if (result.decision.kind !== answer.kind || !answer.ruleIds.every(rule => result.decision.ruleIds.some(actual => actual === rule))) {
      throw new Error(`CORE_DEMO: ${scenario} disagrees with frozen answer key`);
    }
    results.push({ scenario, invoiceId, status: result.status, ruleIds: result.decision.ruleIds, evidenceRefs: result.evidenceRefs });
  }
  const { fields, source } = northfieldChange('bc-legitimate');
  const invoice = northfieldInvoice('4480');
  const vendorSeat = new VendorSeat({ repository, state, now: () => now,
    controller: { request: (decision, refs) => request('vendor_onboarding', decision, refs) },
    checks: {
      // Fixture truth only. CRS IDs are unmapped and no live CRS/Apify response is claimed.
      business: async id => ({ verified: northfield.vendors.some(row => row.id === id), evidenceRef: `synthetic:business:${id}` }),
      ofac: async id => ({ status: northfieldVendor(id).ofacHit ? 'hit' : 'clear', evidenceRef: `synthetic:ofac:${id}` }),
      footprint: async id => {
        const row = northfield.vendors.find(row => row.id === id)!;
        return { ...row.footprint, domain: row.knownDomain, evidenceRef: `synthetic:footprint:${id}` };
      },
    } });
  const proposal = await vendorSeat.propose(fields, source);
  const before = payments.length;
  const held = await ap.process(invoice, northfieldSource('4480'));
  await vendorSeat.apply(source.id);
  if (proposal.status !== 'awaiting_controller' || held.status !== 'held' || payments.length !== before ||
    (await repository.getVendor(fields.vendorId))?.accountId !== northfieldVendor(fields.vendorId).accountId) {
    throw new Error('CORE_DEMO: bank change applied before controller');
  }
  const approvals = new ControllerApprovals(state, { origin: 'http://localhost:3020', rpID: 'localhost', enrollmentSecret: 'seed-test-only' }, () => now);
  const authenticator = new TestAuthenticator();
  const enrollment = await approvals.registrationOptions('seed-test-only');
  await approvals.register('seed-test-only', enrollment.challengeId, authenticator.registration(enrollment.options.challenge));
  const challenge = await approvals.decisionOptions(proposal.escalationId!, { kind: 'Approve' });
  await approvals.decide(proposal.escalationId!, challenge.challengeId, authenticator.assertion(challenge.options.challenge));
  const applied = await vendorSeat.apply(source.id);
  const paid = await ap.process(invoice, northfieldSource('4480'));
  if (applied.status !== 'approved' || paid.status !== 'paid' || payments.at(-1)?.destinationAccountId !== fields.bankAccountId) {
    throw new Error('CORE_DEMO: approved Cedar bank change did not pay from master');
  }
  results.push({ scenario: 'P04', invoiceId: '4480', status: applied.status, ruleIds: applied.decision.ruleIds, evidenceRefs: applied.evidenceRefs });
  const unknown = northfield.vendors.find(row => row.id === 'unverified')!;
  const unverified = await vendorSeat.propose({ kind: 'vendor', vendorId: unknown.id, domain: unknown.knownDomain,
    bankAccountId: unknown.approvedBankRef }, { id: 'seed-unverified', source: 'seed', senderDomain: unknown.knownDomain });
  if (unverified.status !== 'held' || (await repository.getVendor(unknown.id))?.approved) throw new Error('CORE_DEMO: unverified vendor approved');
  const sanctionedVendor = northfield.vendors.find(row => row.id === 'sanctions-test')!;
  const sanctioned = await vendorSeat.propose({ kind: 'vendor', vendorId: sanctionedVendor.id,
    domain: sanctionedVendor.knownDomain, bankAccountId: sanctionedVendor.approvedBankRef },
    { id: 'seed-sanctions-test', source: 'seed', senderDomain: sanctionedVendor.knownDomain });
  if (sanctioned.status !== 'rejected' || !sanctioned.decision.ruleIds.includes('OFAC_STOP') || !sanctioned.escalationId) {
    throw new Error('CORE_DEMO: sanctioned vendor not rejected and escalated');
  }
  // The planted already-paid deposit has neither an exact invoice memo nor the amount for #1046.
  const ar = northfield.arInvoices.find(row => row.id === '1046')!;
  const deposit = northfield.bankTransactions.find(row => row.id === 'seed-credit-unmatched')!;
  const unmatched = reconcile({ accountId: 'receivables', invoiceId: ar.id, installment: 1,
    amountCents: ar.principalCents + ar.lateFeeCents }, deposit.id,
    [{ _id: deposit.id, amount: deposit.amountCents / 100, description: deposit.memo, status: 'completed' }]);
  if (unmatched !== 'exception') throw new Error('CORE_DEMO: unmatched already-paid deposit reconciled');
  return { results, payments, unverified: unverified.status, alreadyPaid: unmatched,
    sanctioned: sanctioned.status, provenance: 'Frozen synthetic Northfield; mocked CRS/Apify/debits; software test passkey', entries: await state.listAudit() };
}
