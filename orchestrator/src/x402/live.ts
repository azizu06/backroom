import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createPublicClient, erc20Abi, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { MemoryStateStore } from '../store';
import { controllerForLease, MemoryFinanceRepository, PayablesSeat } from '../payables';
import { X402_LABEL, X402_NETWORK, X402_USDC } from './index';
import { testnetAccount } from './keychain';
import { loadTestnetWallet } from './cdp';
import { startTestnetVendor } from './vendor';

async function main() {
  if (process.env.X402_LIVE !== '1' || process.env.PAYMENT_RAIL !== 'x402') throw new Error('Opt in with X402_LIVE=1 PAYMENT_RAIL=x402');
  const payer = await loadTestnetWallet(), vendor = testnetAccount('vendor');
  const chain = createPublicClient({ chain: baseSepolia, transport: http('https://sepolia.base.org', { timeout: 20_000, retryCount: 0 }) });
  if (await chain.getChainId() !== 84532) throw new Error('WRONG_CHAIN');
  const balance = await chain.readContract({ address: X402_USDC, abi: erc20Abi, functionName: 'balanceOf', args: [payer.address] });
  if (balance < 10_000n) throw new Error('Fund payer with Base Sepolia USDC at https://faucet.circle.com');
  const invoiceId = 'acme-x402-demo-1';
  const accountId = `x402:${X402_NETWORK}:${vendor.address}`;
  const lineItems = [{ description: 'Acme demo office supplies', quantity: 1, unitPriceCents: 1 }];
  const repository = new MemoryFinanceRepository({ vendors: [{ id: 'acme-x402', domain: 'acme.example', accountId, approved: true, revision: 1 }],
    purchaseOrders: [{ id: 'po-x402', vendorId: 'acme-x402', amountCents: 1, lineItems }] });
  const state = new MemoryStateStore();
  const refs = ['inbox-x402', invoiceId];
  await state.registerAgent('payables-x402', 'payables', Date.now());
  await state.enqueueTask({ id: 'x402-demo', seatId: 'payables', refs, steps: [] });
  const lease = await state.claimTask('payables-x402', Date.now(), 300_000);
  if (!lease) throw new Error('NO_LEASE');
  const vendorServer = await startTestnetVendor({ id: invoiceId, amountCents: 1, payTo: vendor.address });
  const evidenceDir = fileURLToPath(new URL('../../../docs/evidence/x402/', import.meta.url));
  const evidencePath = `${evidenceDir}/live.json`;
  const baseline = { label: X402_LABEL, network: X402_NETWORK, asset: X402_USDC, payer: payer.address, vendor: vendor.address,
    invoiceId, amountCents: 1, facilitator: 'https://www.x402.org/facilitator', faucet: 'https://faucet.circle.com', at: new Date().toISOString() };
  try {
    await mkdir(evidenceDir, { recursive: true });
    // Exclusive durable marker prevents a second invocation silently repaying after a crash.
    await writeFile(evidencePath, JSON.stringify({ ...baseline, status: 'reserved' }, null, 2) + '\n', { flag: 'wx' });
    const seat = new PayablesSeat({ repository, state, controller: controllerForLease(state, lease) });
    const result = await seat.process({ kind: 'invoice', invoiceId, vendorId: 'acme-x402', poId: 'po-x402', amountCents: 1,
      currency: 'USD', bankAccountId: accountId, lineItems }, { id: refs[0]!, source: 'seed', senderDomain: 'acme.example' });
    const evidence = { ...baseline, status: result.status, decision: result.decision, transaction: result.receiptId,
      explorer: result.receiptId ? `https://sepolia.basescan.org/tx/${result.receiptId}` : undefined,
      auditChain: await state.verifyAuditChain(), audit: await state.listAudit() };
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ label: X402_LABEL, status: result.status, explorer: evidence.explorer, evidencePath }));
    if (result.status !== 'paid') process.exitCode = 1;
  } finally { await vendorServer.close(); }
}
main().catch(() => { console.error('x402 testnet live check held. Inspect public evidence/journal; reconcile before any retry.'); process.exitCode = 1; });
