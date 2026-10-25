import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { MemoryStateStore } from '../store';
import { MemoryFinanceRepository, PayablesSeat } from '../payables';
import { createPayablesTools } from '../agents/tools/payables';
import { buildSpecialistServer, newSession } from '../agents/tools';
import type { ToolContext } from '../agents/contracts';
import { loadTestnetWallet } from './cdp';
import { cdpCredentialsPresent, testnetAccount } from './keychain';
import { X402_NETWORK, x402Payables } from './index';
import { startTestnetVendor } from './vendor';
import type { FacilitatorDiagnostic } from './diagnostics';

/** Explicit one-shot TESTNET evidence run through the actual in-process MCP handler. */
async function main() {
  const evidencePath = process.argv[2];
  if (process.env.X402_LIVE !== '1' || process.env.PAYMENT_RAIL !== 'x402' || !cdpCredentialsPresent()) {
    throw new Error('UNAVAILABLE: requires X402_LIVE=1 PAYMENT_RAIL=x402 and both CDP Keychain items');
  }
  if (!evidencePath || !isAbsolute(evidencePath)) throw new Error('Supply an absolute public-evidence journal path outside the repo');
  await mkdir(dirname(evidencePath), { recursive: true });
  // Refuse any repeat even after a crash or an uncertain chain/provider response.
  await writeFile(evidencePath, JSON.stringify({ status: 'reserved', network: X402_NETWORK, amountCents: 1 }) + '\n', { flag: 'wx' });
  const state = new MemoryStateStore();
  const facilitatorDiagnostics: FacilitatorDiagnostic[] = [];
  let vendor: Awaited<ReturnType<typeof startTestnetVendor>> | undefined;
  try {
    const wallet = await loadTestnetWallet();
    if (wallet.walletLabel !== 'Coinbase CDP server wallet') throw new Error('UNAVAILABLE: CDP wallet required');
    const recipient = testnetAccount('vendor').address;
    const fields = { kind: 'invoice' as const, invoiceId: 'acme-x402-inapp-1', vendorId: 'acme-x402', poId: 'po-acme-x402-inapp-1',
      amountCents: 1, currency: 'USD' as const, bankAccountId: `x402:${X402_NETWORK}:${recipient}`,
      lineItems: [{ description: 'Acme office supplies', quantity: 1, unitPriceCents: 1 }] };
    const source = { id: 'invoice:cdp-testnet', source: 'seed' as const, senderDomain: 'acme.example' };
    const repository = new MemoryFinanceRepository({ vendors: [{ id: fields.vendorId, accountId: fields.bankAccountId, domain: source.senderDomain, approved: true, revision: 1 }],
      purchaseOrders: [{ id: fields.poId, vendorId: fields.vendorId, amountCents: 1, lineItems: fields.lineItems }] });
    vendor = await startTestnetVendor({ id: fields.invoiceId, amountCents: 1, payTo: recipient }, { port: 0,
      onFacilitatorResult: event => { facilitatorDiagnostics.push(event); console.log(JSON.stringify({ facilitatorDiagnostic: event })); } });
    const controller = { request: async () => 'cdp-testnet-held' };
    const seat = new PayablesSeat({ repository, state, controller, paymentRail: 'x402',
      x402: x402Payables({ repository, state, vendorOrigin: vendor.origin, signer: () => wallet }) });
    const ctx: ToolContext = { activation: { caseId: 'cdp-testnet', taskId: 'cdp-testnet', activationId: 'cdp-testnet', role: 'payables',
      leaseOwner: 'local-testnet-proof', leaseToken: 1, llmGeneration: 1, artifactRefs: [source.id], credentialOwnerId: 'local', signal: new AbortController().signal },
      assertCurrent: async () => {} };
    const tools = createPayablesTools({ seat, repository, controller, loadCase: async () => ({ fields, source }) });
    const mcp = buildSpecialistServer({ role: 'payables', model: 'claude-haiku-5-5', prompt: '', allowedNext: [], tools }, ctx, newSession());
    const block = (await mcp.definitions.find(tool => tool.name === 'coinbase_x402_pay')!.handler({}, {})).content[0];
    if (block?.type !== 'text') throw new Error('UNAVAILABLE: invalid MCP response');
    const result = JSON.parse(block.text) as { status?: string; receiptId?: string };
    const evidence = { label: 'x402 testnet', network: X402_NETWORK, tool: 'mcp__backroom__coinbase_x402_pay', walletLabel: wallet.walletLabel,
      payer: wallet.address, recipient, invoiceId: fields.invoiceId, amountCents: 1, ...result,
      facilitatorDiagnostics,
      explorer: result.receiptId ? `https://sepolia.basescan.org/tx/${result.receiptId}` : undefined,
      auditChain: await state.verifyAuditChain(), audit: await state.listAudit(), at: new Date().toISOString() };
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ label: evidence.label, status: result.status, walletLabel: wallet.walletLabel,
      payer: wallet.address, transaction: result.receiptId, explorer: evidence.explorer, evidencePath }));
    if (result.status !== 'paid' || !evidence.auditChain.valid) process.exitCode = 1;
  } catch {
    await writeFile(`${evidencePath}.failure.json`, JSON.stringify({ status: 'UNAVAILABLE', audit: await state.listAudit() }, null, 2) + '\n');
    throw new Error('UNAVAILABLE: CDP testnet run held; inspect public journal/audit and reconcile before retrying');
  } finally { await vendor?.close(); }
}
main().catch(() => { console.error('UNAVAILABLE: CDP testnet check held. Inspect the public journal; never remove it to retry an uncertain payment.'); process.exitCode = 1; });
