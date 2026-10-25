import { DEFAULT_POLICY } from '@backroom/policy';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { describe, expect, it, vi } from 'vitest';
import { MemoryStateStore } from '../store';
import { MemoryFinanceRepository, PayablesSeat } from '../payables';
import { x402Payables } from './index';

const address = '0xf3582f2183d22BB09d9AA2B1aC7f721eC4f61180';
const accountId = `x402:eip155:84532:${address}`;
const lines = [{ description: 'Acme demo supplies', quantity: 1, unitPriceCents: 1 }];
const fields = { kind: 'invoice' as const, invoiceId: 'x402-1', vendorId: 'acme-x402', poId: 'po-x402', amountCents: 1, currency: 'USD' as const, bankAccountId: accountId, lineItems: lines };
const source = { id: 'inbox-x402', source: 'seed' as const, senderDomain: 'acme.example' };
function setup(realConfirmation = false) {
  const repository = new MemoryFinanceRepository({ vendors: [{ id: fields.vendorId, domain: 'acme.example', accountId, approved: true, revision: 1 }], purchaseOrders: [{ id: 'po-x402', vendorId: fields.vendorId, amountCents: 1, lineItems: lines }] });
  const state = new MemoryStateStore();
  const network = vi.fn<typeof fetch>();
  const original = privateKeyToAccount(generatePrivateKey());
  const account = { ...original, signTypedData: vi.fn(original.signTypedData) };
  const signer = vi.fn(() => account);
  const confirm = vi.fn(async () => {});
  const client = x402Payables({ repository, state, fetch: network, signer, ...(realConfirmation ? {} : { confirm }) });
  const seat = new PayablesSeat({ repository, state, controller: { request: async () => 'controller-review' }, x402: client, paymentRail: 'x402' });
  return { repository, state, network, signer, confirm, seat, account };
}
describe('x402 testnet Payables policy boundary', () => {
  it('holds a missing PO before loading the key or contacting a vendor', async () => {
    const { seat, network, signer, state } = setup();
    const result = await seat.process({ ...fields, poId: null }, source);
    expect(result.decision.ruleIds).toContain('NO_PO');
    expect(network).not.toHaveBeenCalled();
    expect(signer).not.toHaveBeenCalled();
    expect((await state.listAudit()).some(row => row.decision === 'ESCALATE' && row.inputs?.paymentRail === 'x402 testnet')).toBe(true);
  });
});

it('consumes the process-wide live allowance after an uncertain signature and blocks another repository', async () => {
  vi.stubEnv('X402_LIVE', '1');
  const root = globalThis as typeof globalThis & { backroomX402SignatureAttempted?: boolean };
  delete root.backroomX402SignatureAttempted;
  try {
    const first = setup(true);
    first.network.mockResolvedValueOnce(challenge()).mockRejectedValueOnce(new Error('uncertain transport'));
    expect((await first.seat.process(fields, source)).status).toBe('held');
    expect(first.account.signTypedData).toHaveBeenCalledTimes(1);
    const second = setup(true);
    second.network.mockResolvedValue(challenge());
    expect((await second.seat.process(fields, source)).status).toBe('held');
    expect(second.account.signTypedData).not.toHaveBeenCalled();
    expect(second.network).toHaveBeenCalledTimes(1);
  } finally { delete root.backroomX402SignatureAttempted; vi.unstubAllEnvs(); }
});
it('rejects a vendor asking for mainnet before loading a signing key', async () => {
  const { seat, network, signer, state } = setup();
  network.mockResolvedValue(new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: 'http://127.0.0.1:4027/invoices/x402-1', description: 'x402 testnet', mimeType: 'application/json' }, accepts: [{ scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '10000', payTo: address, maxTimeoutSeconds: 60, extra: { name: 'USD Coin', version: '2' } }] })).toString('base64') } }));
  expect((await seat.process(fields, source)).status).toBe('held');
  expect(network).toHaveBeenCalledTimes(1);
  expect(signer).not.toHaveBeenCalled();
  expect((await state.listAudit()).some(row => row.action === 'x402_testnet_rejected')).toBe(true);
});

const tx = `0x${'ab'.repeat(32)}`;
function challenge(patch: Partial<PaymentRequirements> = {}, extensions?: Record<string, unknown>) {
  const required: PaymentRequired = { x402Version: 2, resource: { url: 'http://127.0.0.1:4027/invoices/x402-1', description: 'x402 testnet', mimeType: 'application/json' },
    accepts: [{ scheme: 'exact', network: 'eip155:84532', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', amount: '10000', payTo: address,
      maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' }, ...patch }], extensions };
  return new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(required) } });
}
function paidNetwork(context: ReturnType<typeof setup>) {
  context.network.mockImplementation(async (_url, init) => {
    const signature = new Headers(init?.headers).get('PAYMENT-SIGNATURE');
    if (!signature) return challenge();
    const payload = decodePaymentSignatureHeader(signature);
    expect(payload.accepted).toMatchObject({ network: 'eip155:84532', amount: '10000', payTo: address });
    return new Response('{}', { headers: { 'PAYMENT-RESPONSE': encodePaymentResponseHeader({ success: true, transaction: tx, network: 'eip155:84532' }) } });
  });
}
it('settles an approved invoice, confirms its transfer, audits the hash, and never repays a replay', async () => {
  const context = setup(); paidNetwork(context);
  const result = await context.seat.process(fields, source);
  expect(result).toMatchObject({ status: 'paid', receiptId: tx, decision: { kind: 'ALLOW' } });
  expect(context.confirm).toHaveBeenCalledWith({ transaction: tx, payer: context.signer.mock.results[0]!.value.address, payTo: address, amount: 10000n, authorizationNonce: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
  expect((await context.seat.process(fields, source)).receiptId).toBe(tx);
  expect(context.network).toHaveBeenCalledTimes(2);
  expect((await context.state.listAudit()).some(row => row.inputs?.transaction === tx)).toBe(true);
  expect((await context.state.verifyAuditChain()).valid).toBe(true);
});
it.each([
  ['amount', { amount: '1000000' }], ['asset', { asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }],
  ['recipient', { payTo: '0x0000000000000000000000000000000000000001' }],
  ['scheme', { scheme: 'upto' }], ['duration', { maxTimeoutSeconds: 10000 }],
  ['domain', { extra: { name: 'Other token', version: '2' } }],
  ['permit2', { extra: { name: 'USDC', version: '2', assetTransferMethod: 'permit2' } }],
])('refuses challenge %s tampering without signing', async (_name, patch) => {
  const context = setup(); context.network.mockResolvedValue(challenge(patch));
  expect((await context.seat.process(fields, source)).status).toBe('held');
  expect(context.signer).not.toHaveBeenCalled();
  expect(context.confirm).not.toHaveBeenCalled();
});
it('refuses unsolicited extensions', async () => {
  const context = setup(); context.network.mockResolvedValue(challenge({}, { malicious: {} }));
  expect((await context.seat.process(fields, source)).status).toBe('held');
  expect(context.signer).not.toHaveBeenCalled();
});
it.each([
  ['NO_PO', { poId: null }, source],
  ['OVER_LIMIT', { amountCents: 200001, lineItems: [{ ...lines[0]!, unitPriceCents: 200001 }] }, source],
  ['BANK_CHANGE_HOLD', { bankAccountId: 'attacker-wallet' }, source],
  ['PAYEE_NOT_IN_MASTER', { vendorId: 'unknown' }, source],
  ['LOOKALIKE_DOMAIN', {}, { ...source, senderDomain: 'acne.example' }],
])('audits %s and performs zero network/signing work', async (rule, patch, envelope) => {
  const context = setup();
  const result = await context.seat.process({ ...fields, ...patch }, envelope);
  expect(result.decision.ruleIds).toContain(rule);
  expect(context.network).not.toHaveBeenCalled();
  expect(context.signer).not.toHaveBeenCalled();
  expect((await context.state.listAudit()).some(row => row.ruleIds.includes(rule) && row.inputs?.paymentRail === 'x402 testnet')).toBe(true);
});
it('sanctions escalate and never contact the network', async () => {
  const context = setup(); const vendor = (await context.repository.getVendor(fields.vendorId))!;
  await context.repository.saveVendor({ ...vendor, ofacHit: true });
  expect((await context.seat.process(fields, source)).decision.ruleIds).toContain('OFAC_STOP');
  expect(context.network).not.toHaveBeenCalled();
  expect((await context.state.listAudit()).some(row => row.decision === 'ESCALATE')).toBe(true);
});
it('holds a different invoice with duplicate goods without a second payment', async () => {
  const context = setup(); paidNetwork(context);
  expect((await context.seat.process(fields, source)).status).toBe('paid');
  expect((await context.seat.process({ ...fields, invoiceId: 'duplicate-copy' }, source)).decision.ruleIds).toContain('DUPLICATE_INVOICE');
  expect(context.network).toHaveBeenCalledTimes(2);
});
it('rechecks vendor master after receiving the challenge', async () => {
  const context = setup();
  context.network.mockImplementation(async () => {
    const vendor = (await context.repository.getVendor(fields.vendorId))!;
    await context.repository.saveVendor({ ...vendor, pendingBankChange: true });
    return challenge();
  });
  expect((await context.seat.process(fields, source)).status).toBe('held');
  expect(context.signer).not.toHaveBeenCalled();
});
it('keeps an uncertain transfer held and never automatically signs again', async () => {
  const context = setup(); paidNetwork(context);
  context.confirm.mockRejectedValue(new Error('RPC unavailable after settlement'));
  expect((await context.seat.process(fields, source)).status).toBe('held');
  expect((await context.seat.process(fields, source)).status).toBe('held');
  expect(context.signer).toHaveBeenCalledTimes(1);
  expect((await context.state.listAudit()).some(row => row.inputs?.transaction === tx)).toBe(true);
});
it('keeps Nessie as default and rejects an unknown rail', async () => {
  const context = setup();
  const payInvoice = vi.fn(async () => ({ id: 'nessie-receipt', status: 'completed' as const }));
  const seat = new PayablesSeat({ repository: context.repository, state: context.state, controller: { request: async () => 'review' }, nessie: { payInvoice }, paymentRail: 'nessie' });
  expect((await seat.process(fields, source)).receiptId).toBe('nessie-receipt');
  expect(context.network).not.toHaveBeenCalled();
  expect(() => new PayablesSeat({ repository: context.repository, state: context.state, controller: { request: async () => 'review' }, paymentRail: 'mainnet' })).toThrow('UNKNOWN_PAYMENT_RAIL');
});

it('DENY for a removed badge action is logged with zero signing or network calls', async () => {
  const context = setup();
  const policy = structuredClone(DEFAULT_POLICY); policy.badges.payables.actions = [];
  vi.spyOn(context.state, 'getPolicy').mockResolvedValue(policy);
  expect((await context.seat.process(fields, source)).decision.kind).toBe('DENY');
  expect(context.network).not.toHaveBeenCalled();
  expect(context.signer).not.toHaveBeenCalled();
  expect((await context.state.listAudit()).some(row => row.decision === 'DENY' && row.inputs?.paymentRail === 'x402 testnet')).toBe(true);
});
it('uses the seat domain normalization for a trusted vendor hostname', async () => {
  const context = setup(); paidNetwork(context);
  const vendor = (await context.repository.getVendor(fields.vendorId))!;
  await context.repository.saveVendor({ ...vendor, domain: ' ACME.EXAMPLE. ' });
  expect((await context.seat.process(fields, source)).status).toBe('paid');
  expect(context.network).toHaveBeenCalledTimes(2);
});
