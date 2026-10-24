/** One opt-in service script; all document inference uses exported createRouter.route. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { createRouter, type RouterFailure } from '../router';
import { visionCases, runVisionCase, visionRoot, visionMetricRow, type VisionReceipt } from './vision';

if (process.env.GX10_VISION_LIVE !== '1') throw new Error('Opt in with GX10_VISION_LIVE=1; GX10 inference only, no cloud/bank/phone');
const failures: RouterFailure[] = [];
let blockedCloudRequests = 0, localRequests = 0;
const guarded: typeof fetch = async (url, init) => {
  const target = new URL(String(url));
  if (!['100.117.44.20', '127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '11434' || target.pathname !== '/v1/chat/completions') {
    blockedCloudRequests++;
    throw new Error('BENCHMARK_CLOUD_FORBIDDEN');
  }
  localRequests++;
  return fetch(url, init);
};
const router = createRouter({ fetch: guarded, localBaseUrl: 'http://127.0.0.1:11434/v1', localVisionModel: 'qwen2.5vl:7b', cloudProvider: 'openrouter', cloudApiKey: 'forbidden', timeoutMs: 120000, onFailure: failure => failures.push(failure) });
const cases = visionCases();
const repeats = Number(process.env.VISION_REPEATS ?? 3);
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 5) throw new Error('VISION_REPEATS must be 1..5');
const receipt: VisionReceipt & { failures: RouterFailure[]; localRequests: number; blockedCloudRequests: number } = {
  version: 1, complete: false, expectedSamples: cases.length * repeats, measuredAt: new Date().toISOString(), sourceSha: process.env.VISION_SOURCE_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: visionRoot, encoding: 'utf8' }).trim(), host: hostname(), model: 'qwen2.5vl:7b',
  scope: 'Live GX10 inference + real bounded rendering/schema/policy. Synthetic visible remittance addenda. All payments and controller effects simulated. Cloud is blocked by transport guard. All attempts retained, including errors and cold start.',
  hashes: Object.fromEntries(['fixtures/vision/manifest.json', 'orchestrator/src/payables/document.ts', 'orchestrator/src/payables/inbox.ts', 'orchestrator/src/router/index.ts', 'orchestrator/src/router/document.ts', 'orchestrator/src/metrics/vision.ts', 'orchestrator/src/metrics/vision-live.ts'].map(path => [path, createHash('sha256').update(readFileSync(`${visionRoot}/${path}`)).digest('hex')])),
  samples: [], failures, localRequests, blockedCloudRequests,
};
mkdirSync(`${visionRoot}/docs/evidence/gx10-vision`, { recursive: true });
for (let repeat = 0; repeat < repeats; repeat++) for (const c of cases) {
  const sample = await runVisionCase(c, router.route);
  receipt.samples.push(sample);
  receipt.localRequests = localRequests; receipt.blockedCloudRequests = blockedCloudRequests;
  writeFileSync(`${visionRoot}/docs/evidence/gx10-vision/receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
  console.log(`${repeat + 1} ${c.id}: exact=${sample.exact} rule=${sample.ruleMatch} ms=${sample.elapsedMs.toFixed(0)}`);
}
receipt.complete = true;
writeFileSync(`${visionRoot}/docs/evidence/gx10-vision/receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
router.stop();
console.log(visionMetricRow(receipt).join(' | '));
