import { x402Client, x402HTTPClient } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import type { PaymentRequirements } from '@x402/core/types';
import type { ClientEvmSigner } from '@x402/evm';
import { createPublicClient, decodeEventLog, erc20Abi, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { evaluate } from '@backroom/policy';
import { masterPayment } from '../payment-boundary';
import { domain } from '../payables/decisions';
import type { FinanceRepository, PayablesClient, SeatOptions } from '../payables/types';
import { loadTestnetWallet, type WalletLabel } from './cdp';
import { facilitatorReason } from './diagnostics';

export const X402_NETWORK = 'eip155:84532' as const;
export const X402_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
export const X402_FACILITATOR = 'https://www.x402.org/facilitator';
export const X402_LABEL = 'x402 testnet';
/** In-process mock vendor/facilitator rail: no keys, chain or internet. */
export const X402_SIMULATED_LABEL = 'x402 simulated';
export type X402Label = typeof X402_LABEL | typeof X402_SIMULATED_LABEL;
type Signer = ClientEvmSigner & { walletLabel?: WalletLabel };
export interface Transfer { transaction: `0x${string}`; payer: string; payTo: string; amount: bigint; authorizationNonce: `0x${string}` }
export interface X402Options {
  repository: FinanceRepository; state: SeatOptions['state'];
  /** Trusted bootstrap config, never a field extracted from an invoice. */
  vendorOrigin?: string; fetch?: typeof fetch; signer?: () => Signer | Promise<Signer>;
  confirm?: (transfer: Transfer) => Promise<void>;
  /** Simulated runs must also inject signer and confirm; the label never selects a network. */
  label?: X402Label;
}
const authorizationAbi = [{ type: 'event', name: 'AuthorizationUsed', inputs: [
  { name: 'authorizer', type: 'address', indexed: true }, { name: 'nonce', type: 'bytes32', indexed: true },
] }] as const;
const lower = (value: string) => value.toLowerCase();
// Shared by console, direct seat and MCP routes. A failed/uncertain signature is never retried.
const live = globalThis as typeof globalThis & { backroomX402SignatureAttempted?: boolean };
const lines = (items: { description: string; quantity: number; unitPriceCents: number }[]) => JSON.stringify(items.map(
  item => [item.description.trim().toLowerCase().replace(/\s+/g, ' '), item.quantity, item.unitPriceCents],
).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));

/** Confirm successful test-USDC Transfer on the fixed chain, not an HTTP success claim. */
export async function confirmTestnetTransfer(transfer: Transfer) {
  const chain = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org', { timeout: 20_000, retryCount: 0 }) });
  if (await chain.getChainId() !== 84532) throw new Error('X402_WRONG_RPC_CHAIN');
  const receipt = await chain.waitForTransactionReceipt({ hash: transfer.transaction, timeout: 60_000 });
  const matched = receipt.logs.some(log => {
    if (lower(log.address) !== lower(X402_USDC)) return false;
    try {
      const event = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics });
      return event.eventName === 'Transfer' && lower(event.args.from) === lower(transfer.payer) &&
        lower(event.args.to) === lower(transfer.payTo) && event.args.value === transfer.amount;
    } catch { return false; }
  });
  const authorized = receipt.logs.some(log => {
    if (lower(log.address) !== lower(X402_USDC)) return false;
    try {
      const event = decodeEventLog({ abi: authorizationAbi, data: log.data, topics: log.topics });
      return lower(event.args.authorizer) === lower(transfer.payer) && event.args.nonce === transfer.authorizationNonce;
    } catch { return false; }
  });
  if (receipt.status !== 'success' || !matched || !authorized) throw new Error('X402_TRANSFER_UNCONFIRMED');
}

/** Under PayablesSeat's vendor lock; re-read trusted policy/master immediately before signing. */
export function x402Payables(options: X402Options): PayablesClient {
  const origin = new URL(options.vendorOrigin ?? 'http://127.0.0.1:4027');
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)))) {
    throw new Error('X402_UNTRUSTED_VENDOR_ORIGIN');
  }
  const label = options.label ?? X402_LABEL, prefix = label.replace(' ', '_');
  if (label !== X402_LABEL && (!options.signer || !options.confirm)) throw new Error('X402_SIMULATION_NEEDS_MOCKS');
  return {
    async payInvoice(input) {
      let policyVersion = 1;
      const log = async (action: string, decision: 'ALLOW' | 'DENY' | 'ESCALATE', inputs: Record<string, unknown>, ruleIds: string[] = []) => {
        await options.state.appendAudit({ ts: Date.now(), actor: 'code', seat: 'payables', action: `${prefix}_${action}`, decision, ruleIds,
          policyVersion, refs: [input.invoiceId, input.vendorId], route: 'code', latencyMs: 0, costUsd: 0,
          inputs: { paymentRail: label, network: X402_NETWORK, ...inputs } });
      };
      const gate = async () => {
        const row = await options.repository.getInvoice(input.vendorId, input.invoiceId);
        const vendor = await options.repository.getVendor(input.vendorId);
        const po = row?.fields.poId ? await options.repository.getPO(row.fields.poId) : undefined;
        const history = await options.repository.listInvoices(input.vendorId);
        if (!row?.paymentAttempted || !row.source || !vendor || row.fields.amountCents !== input.amountCents ||
            row.fields.bankAccountId !== input.destinationAccountId || input.amountCents > 200_000 ||
            input.idempotencyKey !== `ap:${encodeURIComponent(input.vendorId)}:${encodeURIComponent(input.invoiceId)}`) throw new Error('X402_NO_APPROVED_RESERVATION');
        const policy = await options.state.getPolicy?.();
        const decision = evaluate('payables', { type: 'pay_invoice', invoice: { ...row.policyInvoice,
          poMatched: !!po && po.vendorId === input.vendorId && po.amountCents === input.amountCents && lines(po.lineItems) === lines(row.fields.lineItems),
        } }, { policy, vendor: { id: vendor.id, approved: vendor.approved, inMaster: vendor.inMaster ?? true,
          knownDomain: vendor.domain, sourceDomain: row.source.senderDomain, pendingBankChange: await options.repository.hasPendingBankChange(vendor.id) },
          signals: { ofacHit: vendor.ofacHit }, priorInvoices: history.map(item => item.policyInvoice) });
        policyVersion = decision.policyVersion;
        await log('policy', decision.kind, { decision }, decision.ruleIds);
        if (decision.kind !== 'ALLOW' || domain(row.source.senderDomain) !== domain(vendor.domain)) throw new Error('X402_POLICY_BLOCKED');
        await masterPayment({ ...input }, options.repository);
        const match = /^x402:eip155:84532:(0x[0-9a-fA-F]{40})$/.exec(vendor.accountId);
        if (!match) throw new Error('X402_WALLET_NOT_IN_MASTER');
        return match[1]!;
      };
      try {
        let payTo = await gate();
        const url = new URL(`/invoices/${encodeURIComponent(input.invoiceId)}`, origin).href;
        const request = (headers?: Record<string, string>) => (options.fetch ?? fetch)(url, {
          method: 'GET', redirect: 'error', cache: 'no-store', headers, signal: AbortSignal.timeout(90_000),
        });
        await log('attempt', 'ALLOW', { amountCents: input.amountCents, payTo });
        const response = await request();
        if (response.status !== 402) throw new Error('X402_CHALLENGE_REQUIRED');
        const decoder = new x402HTTPClient(new x402Client());
        const required = decoder.getPaymentRequiredResponse(name => response.headers.get(name));
        const amount = String(BigInt(input.amountCents) * 10_000n);
        const valid = (req: PaymentRequirements) => req.scheme === 'exact' && req.network === X402_NETWORK &&
          lower(req.asset) === lower(X402_USDC) && lower(req.payTo) === lower(payTo) && req.amount === amount &&
          req.maxTimeoutSeconds > 0 && req.maxTimeoutSeconds <= 120 &&
          req.extra?.name === 'USDC' && req.extra?.version === '2' &&
          (!req.extra.assetTransferMethod || req.extra.assetTransferMethod === 'eip3009') &&
          (!req.extra.paymentFlow || req.extra.paymentFlow === 'authorization');
        if (required.x402Version !== 2 || required.resource.url !== url || required.accepts.length !== 1 ||
            !valid(required.accepts[0]!) || (required.extensions && Object.keys(required.extensions).length)) throw new Error('X402_UNSAFE_CHALLENGE');
        payTo = await gate();
        // Load credentials only after policy and invoice-bound challenge validation.
        const signer = await (options.signer ?? loadTestnetWallet)();
        await gate(); // Wallet creation/faucet may take time; refresh policy before signing.
        if (!options.confirm) {
          if (process.env.X402_LIVE !== '1' || input.amountCents !== 1) throw new Error('X402_LIVE_ONE_CENT_ONLY');
          if (live.backroomX402SignatureAttempted) throw new Error('X402_ALREADY_ATTEMPTED_THIS_PROCESS');
          live.backroomX402SignatureAttempted = true;
        }
        const walletLabel = signer.walletLabel ?? (label === X402_SIMULATED_LABEL ? 'ephemeral simulated wallet' : 'direct testnet key');
        await log('wallet', 'ALLOW', { payer: signer.address, walletLabel });
        const client = new x402Client().register(X402_NETWORK, new ExactEvmScheme(signer));
        client.setSpendControls({ maxAmountPerPayment: '$2000' });
        client.registerPolicy((version, requirements) => version === 2 ? requirements.filter(valid) : []);
        const protocol = new x402HTTPClient(client);
        const payload = await protocol.createPaymentPayload(required);
        const authorization = payload.payload.authorization as { nonce?: unknown } | undefined;
        if (typeof authorization?.nonce !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(authorization.nonce)) throw new Error('X402_INVALID_AUTHORIZATION');
        const signed = payload.payload.authorization as Record<string, unknown>;
        await log('authorization', 'ALLOW', { payer: signer.address, payTo, amount, asset: X402_USDC,
          domain: { name: 'USDC', version: '2', chainId: 84532 },
          validAfter: signed.validAfter, validBefore: signed.validBefore });
        const paid = await request(protocol.encodePaymentSignatureHeader(payload));
        const settlement = protocol.getPaymentSettleResponse(name => paid.headers.get(name));
        const errorReason = facilitatorReason(settlement.errorReason);
        // Preserve facilitator hash even when later HTTP/chain confirmation fails.
        await log('settlement', settlement.success ? 'ALLOW' : 'ESCALATE', {
          payer: signer.address, walletLabel,
          ...(errorReason ? { errorReason } : {}),
          transaction: settlement.transaction, authorizationNonce: authorization.nonce, success: settlement.success, settlementNetwork: settlement.network,
        });
        if (!paid.ok || !settlement.success || settlement.network !== X402_NETWORK ||
            !/^0x[0-9a-fA-F]{64}$/.test(settlement.transaction) ||
            (settlement.payer && lower(settlement.payer) !== lower(signer.address))) throw new Error('X402_SETTLEMENT_UNCONFIRMED');
        await (options.confirm ?? confirmTestnetTransfer)({ transaction: settlement.transaction as `0x${string}`,
          payer: signer.address, payTo, amount: BigInt(amount), authorizationNonce: authorization.nonce as `0x${string}` });
        return { id: settlement.transaction, status: 'completed' };
      } catch {
        // Never log provider bodies, signatures, authorization payloads or key material.
        await log('rejected', 'ESCALATE', { reason: 'Payment held; reconcile before retrying.' });
        throw new Error('X402_PAYMENT_HELD');
      }
    },
  };
}
