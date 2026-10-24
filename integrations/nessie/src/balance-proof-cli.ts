import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FileClaims, NessieClient } from './index';
import { runBalanceProof } from './balance-proof';

// Read only:              pnpm --filter @backroom/nessie balance-proof
// Fresh account + $1:     pnpm --filter @backroom/nessie balance-proof -- --confirm-sandbox
// Fresh account, no deposit: add --deposit 0
const args = process.argv.slice(2);
const flag = args.indexOf('--deposit');
const depositDollars = flag >= 0 ? Number(args[flag + 1]) : 1;
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
    console.log(`\nTo show judges a rising balance from $0, set in .env.local and restart the host:\nNESSIE_ACCOUNT_ID=${result.fresh.accountId}`);
  }
  console.log(`\nEvidence: ${evidence}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Balance proof failed');
  process.exitCode = 1;
}
