import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { probeVariants } from './probe.js';
import { FileClaims, NessieClient, SANDBOX_LABEL, seedNorthfield } from './index.js';

// Explicitly opt in: pnpm --filter @backroom/nessie live -- --confirm-sandbox
if (!process.argv.includes('--confirm-sandbox')) throw new Error('Pass --confirm-sandbox to create sandbox resources.');
const root = resolve(import.meta.dirname, '../../..');
const claims = new FileClaims(resolve(root, '.nessie-state/claims'));
const events: unknown[] = [];
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /(^_id$|_id$|account_number)/.test(key) ? '<redacted>' : redact(item)]));
  return value;
}
const client = new NessieClient({ apiKey: process.env.NESSIE_API_KEY ?? '', claims,
  observe: event => events.push({ ...event, path: event.path.replace(/(\/(?:accounts|customers)\/)[^/]+/g, '$1<id>'), shape: redact(event.shape) }),
});
try {
  if (process.argv.includes('--probe-variants')) {
    await mkdir(resolve(root, '.nessie-state'), { recursive: true });
    await probeVariants(client, claims, process.env.NESSIE_API_KEY ?? '', resolve(root, '.nessie-state/variants.json'));
    process.exit(0);
  }
  const first = await seedNorthfield(client, claims);
  const again = await seedNorthfield(client, claims);
  if (again.customer._id !== first.customer._id || again.account._id !== first.account._id) throw new Error('Seed not idempotent');
  await client.getCustomer(first.customer._id);
  const before = await client.readBalance(first.account._id);
  const payment = { accountId: first.account._id, invoiceId: 'T4-whole-dollar-2026-10-24', installment: 1, amountCents: 200 };
  const already = (await client.listDeposits(first.account._id)).some(d => d.description.includes('T4-whole-dollar-2026-10-24'));
  const deposit = await client.deposit(payment);
  const replay = await client.deposit(payment);
  const after = await client.readBalance(first.account._id);
  const transactions = await client.listTransactions(first.account._id);
  const pass = !already && replay._id === deposit._id && transactions.some(t => t._id === deposit._id) && Math.round((after - before) * 100) === 200;
  const display = await client.readBalanceWithPostedDeposits(first.account._id);
  const report = `# T4: ${SANDBOX_LABEL}\n\n${pass ? 'PASS' : 'FAIL'} — live API checked ${new Date().toISOString()}.\n\nHost: https://prod-api.nessieisreal.com. Source: [official docs](https://prod.nessieisreal.com/docs), [OpenAPI](https://prod.nessieisreal.com/nessie-openapi-spec.yaml). The legacy api.nessieisreal.com host returned 403.\n\nNorthfield Studio customer and checking account seeded twice with identical IDs. Deposit: $2.00; balance read from GET /accounts/<id>: $${before} → $${after}. ${already ? 'This run reused the prior proof deposit; it cannot establish a fresh increase. The initial whole-dollar attempt also left the bank balance at zero.' : pass ? 'Balance rose by exactly $2.00.' : 'FAIL: deposit persisted but bank balance did not increase; M7 must not claim a reconciled payment from this result.'} Replay returned the same deposit ID; transaction feed contains it. All IDs below redacted.\n\nExplicit display: **${display.label}** = $${display.accountBalance} + $${display.postedDepositsTotal} = $${display.displayTotal}. This is an API-derived formula, not the Nessie account balance or evidence of settlement.\n\n## Requests and response shapes\n\nTimings are client-observed milliseconds including JSON parsing. Query authentication omitted.\n\n\`\`\`json\n${JSON.stringify(events, null, 2)}\n\`\`\`\n`;
  await mkdir(resolve(root, '.nessie-state'), { recursive: true });
  // The report states explicitly when the fixed proof reference was reused.
  const destination = resolve(root, '.nessie-state/t4-latest.md');
  await writeFile(destination, report);
  console.log(JSON.stringify({ label: SANDBOX_LABEL, pass, before, after, display: { label: display.label, accountBalance: display.accountBalance, postedDepositsTotal: display.postedDepositsTotal, displayTotal: display.displayTotal }, reused: already, evidence: destination }));
  if (!pass) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Live sandbox check failed');
  process.exitCode = 1;
}
