import { randomBytes, randomUUID } from 'node:crypto';
import { createPublicClient, erc20Abi, http, verifyTypedData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { ClientEvmSigner } from '@x402/evm';
import { baseSepolia } from 'viem/chains';
import { authorizationTypes } from '@x402/evm';
import type { FacilitatorClient } from '@x402/core/server';
import type { StateStore } from '../store';
import { MemoryFinanceRepository, PayablesSeat } from '../payables';
import type { InvoiceFields, SeatResult } from '../payables/types';
import { X402_LABEL, X402_NETWORK, X402_SIMULATED_LABEL, X402_USDC, x402Payables, type Transfer, type X402Label } from './index';
import { testnetAccount, testnetKeyPresent, cdpCredentialsPresent } from './keychain';
import { loadTestnetWallet, type WalletLabel } from './cdp';
import { startTestnetVendor } from './vendor';

export type X402ConsoleRun = 'simulated' | 'testnet' | 'blocked';
type ConsoleState = Pick<StateStore, 'appendAudit' | 'getEscalation' | 'expireEscalations' | 'getPolicy'>;
/** Browser-safe receipt: labels, public addresses, hashes and audit ids only. */
export interface X402ConsoleResult {
  rail: X402Label; note?: string; scenario: X402ConsoleRun; status: SeatResult['status'] | 'unavailable'; reason?: string; failed?: true;
  replay?: boolean; vendor?: string; invoiceId?: string; amount?: string; amountCents?: number; asset?: string; network?: string;
  payer?: string; walletLabel?: WalletLabel; recipient?: string; policy?: { decision: string; ruleIds: string[]; reason?: string };
  transaction?: string; explorer?: string; holdId?: string; proof?: { vendorRequests: number; signatures: number };
  paymentAuditHref?: string; auditEntryIds?: string[];
}
const VENDOR = 'Acme Supply', VENDOR_ID = 'acme-x402', DOMAIN = 'acme.example';
const lower = (value: string) => value.toLowerCase();
const usd = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const NOTES: Record<X402Label, string> = {
  [X402_SIMULATED_LABEL]: 'Simulated money: in-process mock vendor and facilitator on loopback. No Keychain key, chain or internet.',
  [X402_LABEL]: 'Base Sepolia testnet: worthless test USDC. Not real money.',
};

/** Testnet stays off unless the host opted in AND the macOS Keychain wallet exists. Never reads a secret. */
export function x402TestnetAvailability(env: Record<string, string | undefined> = process.env,
  platform: NodeJS.Platform = process.platform, keyPresent = testnetKeyPresent, cdpPresent = cdpCredentialsPresent) {
  if (root.backroomX402TestnetResult) return { available: false, reason: 'Already paid this session', lastResult: structuredClone(root.backroomX402TestnetResult) };
  if (env.X402_LIVE !== '1') return { available: false, reason: 'Testnet is off. Host opt-in requires X402_LIVE=1. OFFLINE is available.' };
  if (platform !== 'darwin') return { available: false, reason: `Testnet needs the macOS Keychain signer; this host is ${platform}. OFFLINE is available.` };
  if (!keyPresent('vendor')) return { available: false,
    reason: 'UNAVAILABLE: no vendor wallet in Keychain. Run pnpm --filter @backroom/orchestrator x402:wallet.' };
  if (!cdpPresent() && !(env.X402_ALLOW_DIRECT_KEY === '1' && keyPresent('payer'))) return { available: false,
    reason: 'UNAVAILABLE: CDP needs Keychain items backroom-cdp-api-key and backroom-cdp-wallet-secret. Direct fallback requires X402_ALLOW_DIRECT_KEY=1 and x402:wallet.' };
  return { available: true as const };
}

/** Local mock facilitator: verifies the real EIP-3009 signature, then settles to a random fake hash. */
function mockFacilitator(): FacilitatorClient {
  const check = async (payload: Parameters<FacilitatorClient['verify']>[0], required: Parameters<FacilitatorClient['verify']>[1]) => {
    const { authorization: a, signature } = payload.payload as { authorization: { from: `0x${string}`; to: `0x${string}`; value: string; validAfter: string; validBefore: string; nonce: `0x${string}` }; signature: `0x${string}` };
    const valid = lower(a.to) === lower(required.payTo) && a.value === required.amount && await verifyTypedData({
      address: a.from, signature, primaryType: 'TransferWithAuthorization', types: authorizationTypes,
      domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: X402_USDC },
      message: { from: a.from, to: a.to, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore), nonce: a.nonce },
    });
    return { valid, payer: a.from };
  };
  return {
    getSupported: async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: X402_NETWORK }], extensions: [], signers: {} }),
    verify: async (payload, required) => { const { valid, payer } = await check(payload, required); return { isValid: valid, payer }; },
    settle: async (payload, required) => {
      const { valid, payer } = await check(payload, required);
      return { success: valid, payer, network: X402_NETWORK, transaction: valid ? `0x${randomBytes(32).toString('hex')}` : '' };
    },
  };
}

// Testnet keeps one repository per host process: a second click replays the receipt instead of paying again.
const root = globalThis as typeof globalThis & { backroomX402Testnet?: MemoryFinanceRepository; backroomX402TestnetResult?: X402ConsoleResult };
function seed(invoice: InvoiceFields, accountId: string) {
  return new MemoryFinanceRepository({ vendors: [{ id: VENDOR_ID, domain: DOMAIN, accountId, approved: true, revision: 1 }],
    purchaseOrders: invoice.poId ? [{ id: invoice.poId, vendorId: VENDOR_ID, amountCents: invoice.amountCents, lineItems: invoice.lineItems }] : [] });
}

/**
 * Operator-console x402 Payables run. Reuses PayablesSeat + x402Payables + the demo vendor; the result
 * carries only public addresses, hashes and audit ids. `simulated`/`blocked` never load a Keychain key.
 */
export async function runX402Console(run: X402ConsoleRun, state: ConsoleState, options: {
  env?: Record<string, string | undefined>; platform?: NodeJS.Platform; keyPresent?: typeof testnetKeyPresent; cdpPresent?: typeof cdpCredentialsPresent;
  /** Tests only: observe the simulated signer. */ simulatedKey?: () => `0x${string}`;
} = {}): Promise<X402ConsoleResult> {
  if (run === 'testnet' && root.backroomX402TestnetResult) return { ...structuredClone(root.backroomX402TestnetResult), replay: true };
  const label = run === 'testnet' ? X402_LABEL : X402_SIMULATED_LABEL;
  if (run === 'testnet') {
    const gate = x402TestnetAvailability(options.env, options.platform, options.keyPresent, options.cdpPresent);
    if (!gate.available) return { rail: label, scenario: run, status: 'unavailable', reason: gate.reason, failed: true as const };
  }
  const tag = randomUUID().slice(0, 8);
  const amountCents = run === 'testnet' ? 1 : run === 'blocked' ? 245_000 : 125_000;
  let payer: ClientEvmSigner & { walletLabel?: WalletLabel }, recipient: `0x${string}`;
  if (run === 'testnet') {
    try { payer = await loadTestnetWallet(options.env); }
    catch { return { rail: label, scenario: run, status: 'unavailable', failed: true,
      reason: 'UNAVAILABLE: CDP wallet or faucet setup failed. Check Keychain credentials; no payment signed.' }; }
    recipient = testnetAccount('vendor').address;
  }
  else { payer = privateKeyToAccount((options.simulatedKey ?? generatePrivateKey)()); recipient = privateKeyToAccount(generatePrivateKey()).address; }
  const accountId = `x402:${X402_NETWORK}:${recipient}`;
  const invoiceId = run === 'testnet' ? 'acme-x402-inapp-1' : `acme-x402-${run}-${tag}`;
  const lineItems = [{ description: run === 'blocked' ? 'Acme standing desks (over limit)' : 'Acme office supplies', quantity: 1, unitPriceCents: amountCents }];
  const invoice: InvoiceFields = { kind: 'invoice', invoiceId, vendorId: VENDOR_ID, poId: `po-${invoiceId}`, amountCents, currency: 'USD', bankAccountId: accountId, lineItems };
  const repository = run === 'testnet' ? root.backroomX402Testnet ??= seed(invoice, accountId) : seed(invoice, accountId);

  const audits: { id: string; action: string }[] = [];
  const recorded: ConsoleState = {
    appendAudit: async entry => { const row = await state.appendAudit(entry); audits.push({ id: row.id, action: row.action }); return row; },
    getEscalation: id => state.getEscalation(id), expireEscalations: (now, callId) => state.expireEscalations(now, callId), getPolicy: () => state.getPolicy(),
  };
  let vendorRequests = 0, signatures = 0;
  const signer = () => ({ address: payer.address, walletLabel: payer.walletLabel,
    signTypedData: ((...args: Parameters<typeof payer.signTypedData>) => { signatures++; return payer.signTypedData(...args); }) as typeof payer.signTypedData });
  const prior = await repository.getInvoice(VENDOR_ID, invoiceId);
  const replay = !!prior?.paymentAttempted;
  if (run === 'testnet' && !replay) {
    const chain = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org', { timeout: 20_000, retryCount: 0 }) });
    if (await chain.getChainId() !== 84532) throw new Error('X402_WRONG_RPC_CHAIN');
    const balance = await chain.readContract({ address: X402_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [payer.address] });
    if (balance < 10_000n) return { rail: label, scenario: run, status: 'unavailable', failed: true as const, payer: payer.address,
      reason: 'Payer has under 0.01 test USDC. Fund it at faucet.circle.com (USDC, Base Sepolia).' };
  }
  const facilitator = run === 'testnet' ? undefined : mockFacilitator();
  // Blocked and replay runs start no vendor: zero network work is part of the proof.
  const vendor = run === 'blocked' || replay ? undefined
    : await startTestnetVendor({ id: invoiceId, amountCents, payTo: recipient }, { port: 0, facilitator, label,
      ...(run === 'testnet' ? { maxTimeoutSeconds: 600 } : {}) });
  let result: SeatResult;
  try {
    const client = x402Payables({ repository, state: recorded, label, signer,
      ...(run === 'testnet' ? { maxAuthorizationSeconds: 600 } : {}),
      vendorOrigin: vendor?.origin ?? 'http://127.0.0.1:9', // Unused: a blocked invoice never reaches the adapter.
      fetch: (url, init) => { vendorRequests++; return fetch(url, init); },
      ...(run === 'testnet' ? {} : { confirm: async (transfer: Transfer) => {
        if (lower(transfer.payTo) !== lower(recipient) || transfer.amount !== BigInt(amountCents) * 10_000n) throw new Error('X402_SIMULATED_TRANSFER_MISMATCH');
      } }) });
    const seat = new PayablesSeat({ repository, state: recorded, paymentRail: 'x402', x402: client, x402Label: label,
      // Console holds stay here: an x402 payment never takes a passkey exception in place of ALLOW.
      controller: { request: async () => `x402-console-hold:${tag}` } });
    result = await seat.process(invoice, { id: `x402-console:${tag}`, source: 'seed', senderDomain: DOMAIN });
  } finally { await vendor?.close(); }
  const proof = audits.find(row => row.action.endsWith('_completed')) ?? audits.find(row => row.action === 'pay_invoice') ?? audits.at(-1);
  const paid = result.status === 'paid';
  const receipt: X402ConsoleResult = {
    rail: label, note: NOTES[label], scenario: run, status: result.status, replay,
    vendor: VENDOR, invoiceId, amount: usd(amountCents), amountCents, asset: run === 'testnet' ? 'Base Sepolia test USDC' : 'simulated USDC',
    network: X402_NETWORK, payer: payer.address, walletLabel: payer.walletLabel, recipient,
    policy: { decision: result.decision.kind, ruleIds: result.decision.ruleIds,
      ...('reason' in result.decision && typeof result.decision.reason === 'string' ? { reason: result.decision.reason } : {}) },
    transaction: paid ? result.receiptId : undefined,
    explorer: paid && run === 'testnet' ? `https://sepolia.basescan.org/tx/${result.receiptId}` : undefined,
    holdId: result.escalationId, proof: { vendorRequests, signatures },
    paymentAuditHref: proof ? `/audit?entry=${encodeURIComponent(proof.id)}` : undefined, auditEntryIds: audits.map(row => row.id),
    // An allow run that did not settle is a failure to show, not a silent hold.
    ...(run !== 'blocked' && !paid ? { failed: true as const, reason: 'Payment held; open the payment audit and reconcile before retrying.' } : {}),
  };
  if (run === 'testnet' && paid) root.backroomX402TestnetResult = structuredClone(receipt);
  return receipt;
}
