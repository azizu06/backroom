import { describe, expect, it, vi } from 'vitest';
import { MemoryStateStore } from '../store';
import { PayablesSeat, type PayablesClient } from './index';
import { MemoryFinanceRepository } from './repository';

// Temporary synthetic fixtures until stream D's canonical #14 fixture suite lands.
const vendor = { id: 'acme', domain: 'acme-supply.com', accountId: 'acme-approved', approved: true, revision: 1 };
const items = [{ description: 'Paper', quantity: 1, unitPriceCents: 64000 }];
const invoice = { kind: 'invoice' as const, invoiceId: '4500', vendorId: 'acme', poId: 'PO-1', amountCents: 64000, currency: 'USD' as const, bankAccountId: 'acme-approved', lineItems: items };
const source = { id: 'inbox-1', source: 'judge' as const, senderDomain: vendor.domain };
function setup() {
  const repository = new MemoryFinanceRepository({ vendors: [vendor], purchaseOrders: [{ id: 'PO-1', vendorId: 'acme', amountCents: 64000, lineItems: items }] });
  const state = new MemoryStateStore();
  const payment = vi.fn<PayablesClient['payInvoice']>(async () => ({ id: 'nessie-receipt', status: 'completed' }));
  const controller = { request: vi.fn(async () => 'esc-1') };
  const seat = new PayablesSeat({ repository, state, nessie: { payInvoice: payment }, controller });
  return { repository, state, payment, controller, seat };
}
describe('Payables seat', () => {
  it('pays a matching invoice only to the approved master account and reuses the receipt', async () => {
    const { seat, payment } = setup();
    expect((await seat.process(invoice, source)).status).toBe('paid');
    expect(payment).toHaveBeenCalledWith(expect.objectContaining({ destinationAccountId: 'acme-approved', amountCents: 64000, idempotencyKey: 'ap:acme:4500' }));
    expect((await seat.process(invoice, source)).status).toBe('paid');
    expect(payment).toHaveBeenCalledTimes(1);
  });
});

describe('AP traps (temporary fixture cases P02/P03/P05/P06/P09)', () => {
  it.each([
    ['NO_PO', { poId: null }, source],
    ['OVER_LIMIT', { amountCents: 200001, lineItems: [{ ...items[0]!, unitPriceCents: 200001 }] }, source],
    ['BANK_CHANGE_HOLD', { bankAccountId: 'attacker-account' }, source],
    ['PAYEE_NOT_IN_MASTER', { vendorId: 'unknown-vendor' }, source],
    ['LOOKALIKE_DOMAIN', { bankAccountId: 'attacker-account' }, { ...source, senderDomain: 'acme-supp1y.com' }],
  ])('holds %s without invoking Nessie', async (rule, patch, meta) => {
    const { seat, payment } = setup();
    const result = await seat.process({ ...invoice, ...patch }, meta);
    expect(result.status).toBe('held');
    expect(result.decision.ruleIds).toContain(rule);
    expect(payment).not.toHaveBeenCalled();
  });
  it('holds #4419 versus #4402 despite a $37 total difference, with both refs on the audit wall', async () => {
    const { seat, repository, payment, state } = setup();
    await seat.process({ ...invoice, invoiceId: '4402' }, source);
    await repository.saveVendor({ ...vendor, approved: true });
    const result = await seat.process({ ...invoice, invoiceId: '4419', amountCents: 67700, lineItems: [{ ...items[0]!, unitPriceCents: 67700 }] }, { ...source, id: 'inbox-2' });
    expect(result.decision.ruleIds).toContain('DUPLICATE_INVOICE');
    expect(payment).toHaveBeenCalledTimes(1);
    expect((await state.listAudit()).at(-1)?.inputs).toMatchObject({ invoiceId: '4419', relatedInvoiceId: '4402', amountDelta: 37, scenario_source: 'judge' });
  });
  it('serializes concurrent deliveries and never retries a lost response', async () => {
    const { seat, payment } = setup();
    payment.mockRejectedValue(new Error('lost response, maybe committed'));
    const results = await Promise.all([seat.process(invoice, source), seat.process(invoice, source)]);
    expect(results.map(row => row.status)).toEqual(['held', 'held']);
    expect(payment).toHaveBeenCalledTimes(1);
  });
  it('rejects extracted privilege fields and invalid totals before any payment', async () => {
    const { seat, payment } = setup();
    await expect(seat.process({ ...invoice, poMatched: true } as typeof invoice, source)).rejects.toThrow();
    await expect(seat.process({ ...invoice, amountCents: 1 }, source)).rejects.toThrow('TOTAL_MISMATCH');
    expect(payment).not.toHaveBeenCalled();
  });
});
it('treats a pending bank response as uncertain, never as paid', async () => {
  const { seat, payment, state } = setup();
  payment.mockResolvedValue({ id: 'pending-receipt', status: 'pending' });
  expect((await seat.process(invoice, source)).status).toBe('held');
  expect((await state.listAudit()).at(-1)?.action).toBe('payment_uncertain');
});
it('requires the PO line items and amount to match, and refuses unrelated sender domains', async () => {
  const { seat, payment } = setup();
  const wrongPO = await seat.process({ ...invoice, lineItems: [{ ...items[0]!, description: 'Different goods' }] }, source);
  expect(wrongPO.decision.ruleIds).toContain('NO_PO');
  const unknownSender = await seat.process({ ...invoice, invoiceId: '4501' }, { ...source, senderDomain: 'attacker.example' });
  expect(unknownSender.status).toBe('held');
  expect(payment).not.toHaveBeenCalled();
});
it('escalates rather than paying when a Nessie debit adapter is not configured', async () => {
  const { repository, state, controller } = setup();
  const seat = new PayablesSeat({ repository, state, controller });
  expect((await seat.process(invoice, source)).status).toBe('held');
  expect(controller.request).toHaveBeenCalled();
  expect((await repository.getInvoice('acme', '4500'))?.paymentAttempted).toBe(false);
});
