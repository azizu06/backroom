import { expect, it, vi } from 'vitest';
import seed from '../../../fixtures/company/northfield.json';
import { MemoryStateStore } from '../store';
import { PayablesSeat } from './index';
import { createNorthfieldRepository, northfieldInvoice, northfieldSource } from './northfield';

it('holds frozen #4419 against imported paid #4402, preserving the $37 adjustment and both audit refs', async () => {
  const repository = await createNorthfieldRepository();
  // P02's frozen precondition isolates the duplicate from Acme's independent bank-change trap.
  await repository.saveVendor({ ...(await repository.getVendor('acme'))!, pendingBankChange: false });
  const state = new MemoryStateStore();
  const pay = vi.fn(async () => ({ id: 'mock-receipt', status: 'completed' as const }));
  const seat = new PayablesSeat({ repository, state, nessie: { payInvoice: pay }, controller: { request: async () => 'test-escalation' } });
  const result = await seat.process(northfieldInvoice('4419'), northfieldSource('4419'));
  expect(result.decision.ruleIds).toContain('DUPLICATE_INVOICE');
  expect(result.evidenceRefs).toContain('4402');
  expect((await state.listAudit())[0]?.inputs).toMatchObject({ relatedInvoiceId: '4402', amountDelta: 37 });
  expect(pay).not.toHaveBeenCalled();
  expect(seed.apInvoices.find(row => row.id === '4419')?.adjustmentCents).toBe(3700);
});

it.each([
  ['P01', '4401', 'paid', 'IN_BADGE'],
  ['P03', '4471', 'held', 'LOOKALIKE_DOMAIN'],
  ['P05', '4481', 'held', 'NO_PO'],
  ['P06', '4482', 'held', 'OVER_LIMIT'],
  ['P07', '4483', 'held', 'OFAC_STOP'],
  ['P09', '4485', 'held', 'OVER_LIMIT'],
])('%s uses the frozen invoice and enforces %s at the seat boundary', async (_scenario, id, status, rule) => {
  const repository = await createNorthfieldRepository();
  const pay = vi.fn(async () => ({ id: 'mock-receipt', status: 'completed' as const }));
  const seat = new PayablesSeat({ repository, state: new MemoryStateStore(), nessie: { payInvoice: pay }, controller: { request: async () => 'test-escalation' } });
  const result = await seat.process(northfieldInvoice(id!), northfieldSource(id!));
  expect(result.status).toBe(status);
  expect(result.decision.ruleIds).toContain(rule);
  if (status === 'paid') expect(pay).toHaveBeenCalledWith(expect.objectContaining({ destinationAccountId: 'bank-master:papertrail' }));
  else expect(pay).not.toHaveBeenCalled();
});

it('rejects malformed adjustments before a payment capability is invoked', async () => {
  const { invoiceSchema } = await import('./schemas');
  const invoice = northfieldInvoice('4419');
  for (const adjustmentCents of [-1, 1.5, '3700', null]) {
    expect(() => invoiceSchema.parse({ ...invoice, adjustmentCents })).toThrow();
  }
  expect(() => invoiceSchema.parse({ ...invoice, adjustmentCents: 3600 })).toThrow('TOTAL_MISMATCH');
});
