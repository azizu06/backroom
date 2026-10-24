import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FileClaims, NessieClient } from './index';
import { runBalanceProof } from './balance-proof';

// Read only:              pnpm --filter @backroom/nessie balance-proof
// Clean judge account ($0): pnpm --filter @backroom/nessie balance-proof -- --confirm-sandbox
// Proof account (rise shown): add --deposit 1. That account starts at $1, so do NOT give it to judges.
const args = process.argv.slice(2);
const flag = args.indexOf('--deposit');
const depositDollars = flag >= 0 ? Number(args[flag + 1]) : 0;
const root = resolve(import.meta.dirname, '../../..');
// Same durable claim domain as live.ts, so CLI writes never repeat an ambiguous POST.
const claims = new FileClaims(resolve(root, '.nessie-state/claims'));
try {
  if (!process.env.NESSIE_API_KEY) throw new Error('NESSIE_API_KEY missing from .env.local');
  const client = new NessieClient({ apiKey: process.env.NESSIE_API_KEY, claims });
  const result = await runBalanceProof(client, claims, { confirm: args.includes('--confirm-sandbox'), depositDollars });
  await mkdir(resolve(root, '.nessie-state'), { recursive: true });
  const evidence = resolve(root, `.nessie-state/balance-proof-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(evidence, `${JSON.stringify({ checkedAt: new Date().toISOString(), ...result }, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
  if (result.fresh) {
    const { before, after } = result.fresh;
    console.log(`\nProvider account.balance: $${before.accountBalance} -> $${after.accountBalance} (${result.fresh.providerBalanceRose ? 'ROSE' : 'unchanged'})`);
    console.log(`Labelled display (account balance + posted deposits): $${before.displayTotal} -> $${after.displayTotal}`);
    console.log(after.displayTotal === 0
      ? `\nClean $0 account. For judges, set in .env.local and restart the host:\nNESSIE_ACCOUNT_ID=${result.fresh.accountId}`
      : `\nThis proof account starts at $${after.displayTotal}. Do NOT give it to judges: rerun without --deposit for a clean $0 account.`);
  }
  console.log(`\nEvidence: ${evidence}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Balance proof failed');
  process.exitCode = 1;
}
