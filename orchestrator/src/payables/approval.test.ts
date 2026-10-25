import { expect, it, vi } from 'vitest';
import { ControllerApprovals } from '../approvals';
import { TestAuthenticator } from '../approvals/testing/authenticator';
import { MemoryStateStore } from '../store';
import { controllerForLease, PayablesSeat, type PayablesClient } from './index';
import { createNorthfieldRepository, northfieldInvoice, northfieldSource } from './northfield';

it('pays an overridable ESCALATE only after the bound controller passkey approval', async () => {
  let now = 1000;
  const state = new MemoryStateStore();
  const source = northfieldSource('4482');
  const fields = northfieldInvoice('4482');
  await state.registerAgent('payables-seat', 'payables', now);
  await state.enqueueTask({ id: 'payables-4482', seatId: 'payables', refs: [source.id, fields.invoiceId], steps: [] });
  const lease = (await state.claimTask('payables-seat', now, 12000))!;
  const repository = await createNorthfieldRepository();
  const payment = vi.fn<PayablesClient['payInvoice']>(async () => ({ id: 'debit-approved', status: 'completed' }));
  const seat = new PayablesSeat({ repository, state, controller: controllerForLease(state, lease, () => now),
    nessie: { payInvoice: payment }, now: () => now });

  const held = await seat.process(fields, source);
  expect(held).toMatchObject({ status: 'held', decision: { kind: 'ESCALATE', ruleIds: ['OVER_LIMIT'] } });
  expect(payment).not.toHaveBeenCalled();

  const approvals = new ControllerApprovals(state,
    { origin: 'http://localhost:3020', rpID: 'localhost', enrollmentSecret: 'test-enrollment' }, () => now);
  const authenticator = new TestAuthenticator();
  const enrollment = await approvals.registrationOptions('test-enrollment');
  await approvals.register('test-enrollment', enrollment.challengeId, authenticator.registration(enrollment.options.challenge));
  const challenge = await approvals.decisionOptions(held.escalationId!, { kind: 'Approve' });
  await approvals.decide(held.escalationId!, challenge.challengeId, authenticator.assertion(challenge.options.challenge));

  const paid = await seat.process(fields, source);
  expect(paid).toMatchObject({ status: 'paid', receiptId: 'debit-approved',
    decision: { kind: 'ALLOW', ruleIds: ['OVER_LIMIT'] } });
  expect(payment).toHaveBeenCalledTimes(1);
  expect((await state.listAudit()).find(row => row.action === 'pay_invoice_approval_applied')).toMatchObject({
    actor: 'human', decision: 'ALLOW', ruleIds: ['OVER_LIMIT'], refs: expect.arrayContaining([held.escalationId!, fields.invoiceId]),
    inputs: { method: 'passkey', credentialId: authenticator.id },
  });
});
