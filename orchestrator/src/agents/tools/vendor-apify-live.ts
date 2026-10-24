/** Opt-in: VENDOR_APIFY=live runs the Store Contact Details Scraper once on a public site (cap $0.05). */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ApifyBudget, CONTACT_CAP_USD, createContactRunner, projectContactItems } from './vendor-apify';

const envPath = fileURLToPath(new URL('../../../../.env.local', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
if (process.env.VENDOR_APIFY !== 'live') {
  console.log('SKIP: VENDOR_APIFY=live opts into one billed Contact Details Scraper run.');
} else {
  const budget = new ApifyBudget();
  const reservation = budget.reserve('live-smoke', CONTACT_CAP_USD);
  if (!reservation.ok) throw new Error(reservation.reason);
  const started = performance.now();
  const scrape = await createContactRunner()({ startUrl: process.argv[2] ?? 'https://kimsislandsi.com/', capUsd: reservation.capUsd, signal: new AbortController().signal });
  reservation.settle(scrape.usageUsd);
  console.log(JSON.stringify({ runId: scrape.runId, usageUsd: scrape.usageUsd, spentUsd: budget.spentUsd,
    latencyMs: Math.round(performance.now() - started), footprint: projectContactItems(scrape.items) }, null, 2));
}
