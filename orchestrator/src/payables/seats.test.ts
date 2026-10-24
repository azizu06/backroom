import { describe, expect, it, vi } from 'vitest';
import { MemoryStateStore } from '../store';
import { PayablesSeat, type PayablesClient } from './index';
import { createNorthfieldRepository, northfieldInvoice, northfieldSource, northfieldVendor } from './northfield';

const vendor = northfieldVendor('papertrail');
const invoice = northfieldInvoice('4401');
const items = invoice.lineItems;
const source = northfieldSource('4401');
async function setup() {
  const repository = await createNorthfieldRepository();
  const state = new MemoryStateStore();
  const payment = vi.fn<PayablesClient['payInvoice']>(async () => ({ id: 'nessie-receipt', status: 'completed' }));
  const controller = { request: vi.fn(async () => 'esc-1') };
  const seat = new PayablesSeat({ repository, state, nessie: { payInvoice: payment }, controller });
  return { repository, state, payment, controller, seat };
}
describe('Payables seat', () => {
  it('pays a matching invoice only to the approved master account and reuses the receipt', async () => {
    const { seat, payment } = await setup();
    expect((await seat.process(invoice, source)).status).toBe('paid');
    expect(payment).toHaveBeenCalledWith(expect.objectContaining({ destinationAccountId: 'bank-master:papertrail', amountCents: 64000, idempotencyKey: 'ap:papertrail:4401' }));
    expect((await seat.process(invoice, source)).status).toBe('paid');
    expect(payment).toHaveBeenCalledTimes(1);
  });
});

describe('AP mutation defenses on the Northfield P01 control', () => {
  it.each([
    ['NO_PO', { poId: null }, source],
    ['OVER_LIMIT', { amountCents: 200001, lineItems: [{ ...items[0]!, unitPriceCents: 200001 }] }, source],
    ['BANK_CHANGE_HOLD', { bankAccountId: 'attacker-account' }, source],
    ['PAYEE_NOT_IN_MASTER', { vendorId: 'unknown-vendor' }, source],
    ['LOOKALIKE_DOMAIN', { bankAccountId: 'attacker-account' }, { ...source, senderDomain: 'papertrai1.example' }],
  ])('holds %s without invoking Nessie', async (rule, patch, meta) => {
    const { seat, payment } = await setup();
    const result = await seat.process({ ...invoice, ...patch }, meta);
    expect(result.status).toBe('held');
    expect(result.decision.ruleIds).toContain(rule);
    expect(payment).not.toHaveBeenCalled();
  });
  it('serializes concurrent deliveries and never retries a lost response', async () => {
    const { seat, payment } = await setup();
    payment.mockRejectedValue(new Error('lost response, maybe committed'));
    const results = await Promise.all([seat.process(invoice, source), seat.process(invoice, source)]);
    expect(results.map(row => row.status)).toEqual(['held', 'held']);
    expect(payment).toHaveBeenCalledTimes(1);
  });
  it('rejects extracted privilege fields and invalid totals before any payment', async () => {
    const { seat, payment } = await setup();
    await expect(seat.process({ ...invoice, poMatched: true } as typeof invoice, source)).rejects.toThrow();
    await expect(seat.process({ ...invoice, amountCents: 1 }, source)).rejects.toThrow('TOTAL_MISMATCH');
    expect(payment).not.toHaveBeenCalled();
  });
});
it('treats a pending bank response as uncertain, never as paid', async () => {
  const { seat, payment, state } = await setup();
  payment.mockResolvedValue({ id: 'pending-receipt', status: 'pending' });
  expect((await seat.process(invoice, source)).status).toBe('held');
  expect((await state.listAudit()).at(-1)?.action).toBe('payment_uncertain');
});
it('requires the PO line items and amount to match, and refuses unrelated sender domains', async () => {
  const { seat, payment } = await setup();
  const wrongPO = await seat.process({ ...invoice, lineItems: [{ ...items[0]!, description: 'Different goods' }] }, source);
  expect(wrongPO.decision.ruleIds).toContain('NO_PO');
  const unknownSender = await seat.process({ ...invoice, invoiceId: '4501' }, { ...source, senderDomain: 'attacker.example' });
  expect(unknownSender.status).toBe('held');
  expect(payment).not.toHaveBeenCalled();
});
it('escalates rather than paying when a Nessie debit adapter is not configured', async () => {
  const { repository, state, controller } = await setup();
  const seat = new PayablesSeat({ repository, state, controller });
  expect((await seat.process(invoice, source)).status).toBe('held');
  expect(controller.request).toHaveBeenCalled();
  expect((await repository.getInvoice('papertrail', '4401'))?.paymentAttempted).toBe(false);
});
