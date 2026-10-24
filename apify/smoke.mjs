// Run from the repository root. Never logs credentials, raw API objects, or Actor logs.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { cases, runOptions, summarizeRun, publicItems, billingComplete } from './smoke-lib.mjs';

const output = new URL('../fixtures/apify/t5-smoke.json', import.meta.url);
for (const path of [output, new URL('../fixtures/apify/t5-maps-started.json', import.meta.url), new URL('../fixtures/apify/t5-search-started.json', import.meta.url)]) {
  try { await access(path); throw new Error('Evidence already exists; refusing an accidental paid rerun.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

let token = process.env.APIFY_TOKEN;
if (!token) {
  const env = await readFile(new URL('../.env.local', import.meta.url), 'utf8');
  const match = env.match(/^\s*(?:export\s+)?APIFY_TOKEN\s*=\s*(.*?)\s*$/m);
  token = match?.[1]?.replace(/^(['"])(.*)\1$/, '$2');
}
if (!token) throw new Error('APIFY_TOKEN is missing. No run started.');

function safeMessage(message) {
  return String(message ?? '').replaceAll(token, '[redacted]').replace(/https?:\/\/\S+/g, '[url redacted]').slice(0, 600);
}

async function api(path, options = {}) {
  const response = await fetch(`https://api.apify.com/v2/${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(safeMessage(body.error?.message));
    error.httpStatus = response.status;
    error.apiType = body.error?.type ?? 'unknown';
    throw error;
  }
  return body.data ?? body;
}

const observedAt = new Date().toISOString();
const account = await api('users/me');
const limits = await api('users/me/limits');
const headroomUsd = account.plan.monthlyUsageCreditsUsd - limits.current.monthlyUsageUsd;
if (!(headroomUsd >= 1)) throw new Error('At least $1 remaining included credit is required. No run started.');
const accountPreflight = {
  observedAt, plan: account.plan.id, includedMonthlyCreditUsd: account.plan.monthlyUsageCreditsUsd,
  monthlyUsageUsd: limits.current.monthlyUsageUsd, includedCreditRemainingUsd: headroomUsd,
};
const results = [];
for (const item of cases) {
  const metadata = await api(`acts/${item.actor}`);
  const pricing = metadata.pricingInfos.filter(p => Date.parse(p.startedAt) <= Date.now()).at(-1);
  const build = await api(`acts/${item.actor}/builds/default`);
  const fields = build.actorDefinition.input.properties;
  for (const key of Object.keys(item.input)) {
    if (!Object.hasOwn(fields, key)) throw new Error(`Input field missing from live schema: ${item.name}.${key}`);
  }
  results.push({
    name: item.name, actor: item.actor, input: item.input,
    schemaBuildId: build.id, schemaBuildNumber: build.buildNumber,
    pricing: {
      model: pricing.pricingModel, effectiveAt: pricing.startedAt,
      minimumConfigurableCapUsd: pricing.minimalMaxTotalChargeUsd ?? null,
      events: Object.fromEntries(Object.entries(pricing.pricingPerEvent.actorChargeEvents).map(([key, event]) => [key, {
        priceUsd: event.eventPriceUsd ?? null,
        freeTierPriceUsd: event.eventTieredPricingUsd?.FREE?.tieredEventPriceUsd ?? null,
      }])),
    },
  });
}

// Exactly one paid attempt per Actor; $0.50 minimum platform cap each. Measured target remains <$0.10.
const start = performance.now();
const activeRuns = new Map();
const abortReceipts = [];
const isActive = run => ['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'].includes(run.status);
const deadline = setTimeout(() => {
  for (const [id, run] of activeRuns) {
    if (isActive(run)) abortReceipts.push(api(`actor-runs/${id}/abort?gracefully=false`, { method: 'POST' }).catch(() => null));
  }
}, 55_000);
await Promise.all(results.map(async result => {
  try {
    const query = new URLSearchParams({ ...runOptions, waitForFinish: '0', build: result.schemaBuildNumber });
    let run = await api(`acts/${result.actor}/runs?${query}`, { method: 'POST', body: JSON.stringify(result.input) });
    activeRuns.set(run.id, run);
    result.run = summarizeRun(run);
    // Persist each accepted run immediately so an interrupted client cannot lose its identity.
    await writeFile(new URL(`../fixtures/apify/t5-${result.name}-started.json`, import.meta.url), `${JSON.stringify({ observedAt, actor: result.actor, run: result.run }, null, 2)}\n`);
    while (isActive(run) && performance.now() - start < 55_000) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      run = await api(`actor-runs/${run.id}?waitForFinish=1`);
      activeRuns.set(run.id, run);
    }
    if (isActive(run)) {
      run = await api(`actor-runs/${run.id}/abort?gracefully=false`, { method: 'POST' });
    }
    activeRuns.set(run.id, run);
    result.items = publicItems(result.name, await api(`datasets/${run.defaultDatasetId}/items?clean=true&limit=1`));
    const primaryEvent = result.name === 'maps' ? 'place-scraped' : 'search-page-scraped';
    for (let attempt = 0; run.status === 'SUCCEEDED' && !billingComplete(run, primaryEvent) && attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      run = await api(`actor-runs/${run.id}`);
    }
    result.run = summarizeRun(run);
    result.billingVerified = billingComplete(run, primaryEvent);
    result.billingObservedAt = new Date().toISOString();
  } catch (error) {
    result.error = { httpStatus: error.httpStatus ?? null, type: error.apiType ?? error.name, message: safeMessage(error.message) };
  }
}));
clearTimeout(deadline);
await Promise.all(abortReceipts);
const elapsedSecs = (performance.now() - start) / 1000;
const costKnown = results.every(r => r.run?.costUsd != null);
const totalCostUsd = costKnown ? results.reduce((sum, r) => sum + r.run.costUsd, 0) : null;
const maps = results.find(r => r.name === 'maps');
const closurePresent = typeof maps.items?.[0]?.permanentlyClosed === 'boolean';
const passed = results.every(r => r.run?.status === 'SUCCEEDED' && r.items?.length && r.billingVerified) && closurePresent && elapsedSecs <= 60 && totalCostUsd != null && totalCostUsd < 0.10;
const evidence = {
  issue: 6, spec: '8.1 T5; 4.8', observedAt, company: "Kim's Island Chinese Restaurant, Staten Island, New York",
  status: passed ? 'PASS' : 'BLOCKED_OR_FAILED', elapsedSecs, totalCostUsd, runOptions, accountPreflight, results,
  cachedDataAvailable: results.every(r => r.items?.length),
};
await mkdir(new URL('../fixtures/apify/', import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ status: evidence.status, evidence: 'fixtures/apify/t5-smoke.json', elapsedSecs, totalCostUsd, results: results.map(r => ({ name: r.name, runId: r.run?.runId ?? null, status: r.run?.status ?? null, error: r.error })) }));
process.exitCode = passed ? 0 : 1;
