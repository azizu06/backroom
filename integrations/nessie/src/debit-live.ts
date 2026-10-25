import { resolve } from 'node:path';
import { FileClaims, NessieClient, withdrawalMemo } from './index.js';

if (!process.argv.includes('--confirm-sandbox-debit')) {
  throw new Error('Pass --confirm-sandbox-debit to move simulated Nessie sandbox money.');
}
const apiKey = process.env.NESSIE_API_KEY;
const accountId = process.env.NESSIE_ACCOUNT_ID;
if (!apiKey || !accountId) throw new Error('NESSIE_API_KEY and NESSIE_ACCOUNT_ID are required.');

const claims = new FileClaims(resolve(process.env.NESSIE_CLAIMS_DIR || '.nessie-state/claims'));
const bank = new NessieClient({ apiKey, surface: 'nessie_sandbox', claims });
const request = { accountId, vendorId: 'backroom-smoke', invoiceId: 'P01-sandbox-smoke-v1', amountCents: 100 };
try {
  const already = (await bank.listWithdrawals(accountId)).some(row => row.description === withdrawalMemo(request));
  const debit = await bank.withdraw(request);
  const reconciliation = await bank.reconcileWithdrawal(request, debit._id);
  console.log(JSON.stringify({ sandbox: true, amountCents: request.amountCents, replayed: already,
    debitId: '<redacted>', transactionId: reconciliation.transactionId ? '<redacted>' : null, match: reconciliation.match }));
  if (reconciliation.match !== 'EXACT') process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Nessie sandbox debit smoke failed');
  process.exitCode = 1;
}
