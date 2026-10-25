import { afterEach, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from '@x402/core/http';
import { MemoryStateStore } from '../../store';
import { MemoryFinanceRepository, PayablesSeat } from '../../payables';
import { x402Payables, X402_NETWORK, X402_USDC } from '../../x402';
import { createPayablesTools } from './payables';
import { buildSpecialistServer, newSession } from '../tools';
import type { ToolContext } from '../contracts';

const sdk = vi.hoisted(() => ({ create: vi.fn(), faucet: vi.fn(), credentials: vi.fn(), present: vi.fn(() => true) }));
vi.mock('../../x402/keychain', () => ({ cdpCredentials: sdk.credentials, cdpCredentialsPresent: sdk.present }));
vi.mock('@coinbase/cdp-sdk', () => ({ CdpClient: class { evm = { getOrCreateAccount: sdk.create, requestFaucet: sdk.faucet }; } }));
vi.mock('viem', async original => ({ ...await original<typeof import('viem')>(), createPublicClient: () => ({
  getChainId: async () => 84532, readContract: async () => 100_000n,
}) }));

const recipient = '0xf3582f2183d22BB09d9AA2B1aC7f721eC4f61180';
const tx = `0x${'ab'.repeat(32)}`;
const ctx: ToolContext = { activation: { caseId: 'case-cdp', taskId: 'task-cdp', activationId: 'act-cdp', role: 'payables',
  leaseOwner: 'worker', leaseToken: 1, llmGeneration: 1, artifactRefs: ['invoice:cdp'], credentialOwnerId: 'owner', signal: new AbortController().signal }, assertCurrent: async () => {} };
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

async function setup(overrides = {}) {
  vi.stubEnv('X402_LIVE', '1');
  sdk.credentials.mockReturnValue({ apiKeyId: 'test', apiKeySecret: 'test', walletSecret: 'test' });
  const account = privateKeyToAccount(generatePrivateKey());
  const sign = vi.fn(account.signTypedData);
  sdk.create.mockResolvedValue({ address: account.address, signTypedData: sign });
  const fields = { kind: 'invoice' as const, invoiceId: 'cdp-cent', vendorId: 'acme-x402', poId: 'po', amountCents: 1, currency: 'USD' as const,
    bankAccountId: `x402:${X402_NETWORK}:${recipient}`, lineItems: [{ description: 'Office supplies', quantity: 1, unitPriceCents: 1 }], ...overrides };
  const source = { id: 'invoice:cdp', source: 'seed' as const, senderDomain: 'acme.example' };
  const repository = new MemoryFinanceRepository({ vendors: [{ id: fields.vendorId, accountId: fields.bankAccountId, domain: source.senderDomain, approved: true, revision: 1 }],
    purchaseOrders: [{ id: 'po', vendorId: fields.vendorId, amountCents: 1, lineItems: fields.lineItems }] });
  const state = new MemoryStateStore();
  const network = vi.fn<typeof fetch>(async (_url, init) => {
    const signature = new Headers(init?.headers).get('PAYMENT-SIGNATURE');
    if (signature) {
      const payload = decodePaymentSignatureHeader(signature);
      expect(payload.accepted).toMatchObject({ amount: '10000', payTo: recipient, asset: X402_USDC, network: X402_NETWORK });
      return new Response('{}', { headers: { 'PAYMENT-RESPONSE': encodePaymentResponseHeader({ success: true, transaction: tx, network: X402_NETWORK, payer: account.address }) } });
    }
    return new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader({ x402Version: 2,
      resource: { url: 'http://127.0.0.1:4027/invoices/cdp-cent', description: 'Invoice', mimeType: 'application/json' },
      accepts: [{ scheme: 'exact', network: X402_NETWORK, asset: X402_USDC, amount: '10000', payTo: recipient, maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' } }] }) } });
  });
  const confirm = vi.fn(async () => {});
  const controller = { request: async () => 'held' };
  const seat = new PayablesSeat({ repository, state, controller, paymentRail: 'x402', x402: x402Payables({ repository, state, fetch: network, confirm }) });
  const tools = createPayablesTools({ seat, repository, controller, loadCase: async () => ({ fields, source }) });
  const server = buildSpecialistServer({ role: 'payables', model: 'claude-haiku-5-5', prompt: '', allowedNext: [], tools }, ctx, newSession());
  const pay = server.definitions.find(t => t.name === 'coinbase_x402_pay')!;
  const call = async () => {
    const block = (await pay.handler({}, {})).content[0];
    if (block?.type !== 'text') throw new Error('EXPECTED_TEXT');
    return JSON.parse(block.text);
  };
  return { call, tools, server, network, sign, confirm, account, state };
}

it('MCP pays via the mocked CDP SDK and the existing policy/402/confirmation boundary once', async () => {
  const job = await setup();
  expect(job.server.allowedNames).toContain('mcp__backroom__coinbase_x402_pay');
  expect(await job.call()).toMatchObject({ status: 'paid', verdict: 'ALLOW', receiptId: tx });
  expect(await job.call()).toMatchObject({ status: 'paid', receiptId: tx });
  expect(sdk.create).toHaveBeenCalledExactlyOnceWith({ name: 'backroom-payables' });
  expect(job.sign).toHaveBeenCalledTimes(1);
  expect(job.confirm).toHaveBeenCalledWith(expect.objectContaining({ payer: job.account.address, amount: 10000n, payTo: recipient }));
  expect((await job.state.listAudit()).some(a => a.inputs?.walletLabel === 'Coinbase CDP server wallet')).toBe(true);
  expect((await job.state.verifyAuditChain()).valid).toBe(true);
});

it('MCP policy holds sign nothing and contact neither CDP nor vendor', async () => {
  const job = await setup({ poId: null });
  expect(await job.call()).toMatchObject({ status: 'held', verdict: 'ESCALATE' });
  expect(job.network).not.toHaveBeenCalled();
  expect(sdk.create).not.toHaveBeenCalled();
  expect(job.sign).not.toHaveBeenCalled();
});

it('MCP refuses missing opt-in and model-supplied money fields', async () => {
  const job = await setup();
  vi.stubEnv('X402_LIVE', '0');
  expect(await job.call()).toMatchObject({ status: 'UNAVAILABLE' });
  expect(job.tools.find(t => t.name === 'coinbase_x402_pay')!.input.safeParse({ amount: 1, network: 'eip155:8453' }).success).toBe(false);
  expect(job.sign).not.toHaveBeenCalled();
});
