import { expect, it, vi } from 'vitest';
import { FakeEffects, MemoryFinanceRepository, nessiePayables } from './index';

const vendor = { id: 'vendor:1', domain: 'studio-vendor.example', accountId: 'master:approved', approved: true, revision: 1 };
const invoice = { id: 'ap:new', vendorId: vendor.id, amountCents: 50000, account: 'operating', poMatched: true,
  lineItems: [{ description: 'Studio services', quantity: 1, unitPriceCents: 50000 }] };

it('RT-301 rejects a recipient override inside the effect even when upstream policy allowed it', async () => {
  const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [vendor] }));
  await expect(effects.nessie({ idempotencyKey: 'RT-301', input: { invoice, payeeAccountId: 'attacker:unapproved' } }))
    .rejects.toThrow('PAYEE_NOT_IN_MASTER');
  expect(effects.calls).toEqual([]);
});

it('resolves a clean payment from trusted master state and strips raw source text', async () => {
  const effects = new FakeEffects(new MemoryFinanceRepository({ vendors: [vendor] }));
  await effects.nessie({ idempotencyKey: 'clean', input: { invoice, sourceText: 'Untrusted document' } });
  expect(effects.calls[0]?.input).toEqual({ invoiceId: 'ap:new', vendorId: vendor.id, amountCents: 50000,
    sourceAccount: 'operating', destinationAccountId: 'master:approved' });
});

it('rejects missing/revoked masters and rechecks after work queued at the effect boundary', async () => {
  const repository = new MemoryFinanceRepository({ vendors: [vendor] });
  const effects = new FakeEffects(repository);
  effects.beforeEffect = () => repository.saveVendor({ ...vendor, approved: false });
  await expect(effects.nessie({ idempotencyKey: 'revoked', input: { invoice } })).rejects.toThrow('PAYEE_NOT_IN_MASTER');
  await expect(new FakeEffects().nessie({ idempotencyKey: 'missing', input: { invoice } })).rejects.toThrow('PAYEE_NOT_IN_MASTER');
  expect(effects.calls).toEqual([]);
});

it('RT-301 blocks an unapproved destination at the real Nessie bridge before its network capability', async () => {
  const network = { nessie: vi.fn(async () => ({ externalId: 'receipt', status: 'completed' })) };
  const bridge = nessiePayables(network, new MemoryFinanceRepository({ vendors: [vendor] }));
  await expect(bridge.payInvoice({ idempotencyKey: 'RT-301', invoiceId: 'ap:new', vendorId: vendor.id,
    amountCents: 50000, sourceAccount: 'operating', destinationAccountId: 'attacker:unapproved' })).rejects.toThrow('PAYEE_NOT_IN_MASTER');
  expect(network.nessie).not.toHaveBeenCalled();
});

it('passes only canonical master-bound fields to a real adapter and preserves its receipt', async () => {
  const network = { nessie: vi.fn(async () => ({ externalId: 'receipt', status: 'completed' })) };
  const bridge = nessiePayables(network, new MemoryFinanceRepository({ vendors: [vendor] }));
  const input = { idempotencyKey: 'clean', invoiceId: 'ap:new', vendorId: vendor.id,
    amountCents: 50000, sourceAccount: 'operating', destinationAccountId: vendor.accountId };
  expect(await bridge.payInvoice(input)).toEqual({ id: 'receipt', status: 'completed' });
  const { idempotencyKey, ...payment } = input;
  expect(network.nessie).toHaveBeenCalledWith({ idempotencyKey, input: payment });
});

it.each(['unapproved', 'ofac', 'pending', 'unknown', 'nested-override'])('fails closed on %s at the effect boundary', async state => {
  const repository = new MemoryFinanceRepository({ vendors: [{ ...vendor,
    approved: state !== 'unapproved', ofacHit: state === 'ofac' }] });
  if (state === 'pending') vi.spyOn(repository, 'hasPendingBankChange').mockResolvedValue(true);
  const effects = new FakeEffects(repository);
  const input = { invoice: { ...invoice, vendorId: state === 'unknown' ? 'missing' : vendor.id,
    ...(state === 'nested-override' ? { destinationAccountId: 'attacker:unapproved' } : {}) } };
  await expect(effects.nessie({ idempotencyKey: state, input })).rejects.toThrow('PAYEE_NOT_IN_MASTER');
  expect(effects.calls).toEqual([]);
});
