import { Actor, log } from 'apify';
import { healthResult, probeWebsite } from './signals.js';

await Actor.init();
const input = await Actor.getInput() as {
  companyName?: string; website?: string; phone?: string; listedPhone?: string;
  maps?: { permanentlyClosed?: boolean; temporarilyClosed?: boolean; sourceUrl?: string; observedAt?: string };
} | null;
const observedAt = new Date().toISOString();
const websiteStatus = input?.website ? await probeWebsite(input.website, fetch, AbortSignal.timeout(10_000)) : undefined;
const result = healthResult({ ...input, websiteStatus, observedAt });
log.info('Client health signals ready', { count: result.signals.length });
await Actor.pushData(result);
await Actor.exit();
