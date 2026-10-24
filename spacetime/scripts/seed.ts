import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SpacetimeTransport } from '../../orchestrator/src/spacetime-store';

async function main() {
  const env = new URL('../../.env.local', import.meta.url);
  if (existsSync(env)) process.loadEnvFile(fileURLToPath(env));
  const seed = JSON.parse(readFileSync(new URL('../../fixtures/company/northfield.json', import.meta.url), 'utf8'));
  const transport = new SpacetimeTransport({ uri: process.env.SPACETIMEDB_URI ?? '', database: process.env.SPACETIMEDB_DATABASE ?? '', token: process.env.SPACETIMEDB_TOKEN ?? '' });
  try {
    await transport.seedCompany(seed);
    console.log(`Seeded ${seed.company.name}: ${seed.clients.length} clients, ${seed.vendors.length} vendors, ${seed.arInvoices.length} AR and ${seed.apInvoices.length} AP invoices. Synthetic; provider IDs remain unprovisioned.`);
  } finally { transport.close(); }
}
main().catch(() => { console.error('State seed failed; verify private SpacetimeDB publisher configuration.'); process.exitCode = 1; });
