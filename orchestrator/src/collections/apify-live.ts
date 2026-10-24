/** One explicit website-only Actor run through the core demo; no model, phone, or bank network. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runCoreDemo } from '../core-demo/core';
import { APIFY_DEMO_COMPANY } from './apify';

const envPath = fileURLToPath(new URL('../../../.env.local', import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);
if (process.env.PRECALL_APIFY !== 'live') {
  console.log('SKIP: PRECALL_APIFY=live opts into one billed, website-only Actor run.');
} else {
  const started = performance.now();
  const demo = await runCoreDemo({ apify: 'live' });
  const health = demo.entries.find(row => row.action === 'health_check');
  const receipt = {
    measuredAt: new Date().toISOString(), actorId: 'WQJ4xRGzZN1xj967Z', build: '0.0.3',
    company: APIFY_DEMO_COMPANY, runId: health?.inputs?.runId,
    healthLatencyMs: health?.latencyMs, latencyMs: Math.round(performance.now() - started),
    latencyScope: 'complete core demo including the Apify pre-call',
    status: health?.inputs?.status, signals: health?.inputs?.signals,
    label: health?.inputs?.label, chainValid: demo.chainValid,
    limits: { maxTotalChargeUsd: 0.10, actorTimeoutSecs: 35, preCallDeadlineSecs: 40, mapsRuns: 0, retries: 0 },
    simulated: ['AR company/client/consent', 'CRS', 'call plan/model', 'phone call', 'Nessie', 'controller passkey'],
    note: 'T5 public-company probe is separate from the synthetic AR company; website signal only, no fresh Maps claim.',
  };
  const directory = fileURLToPath(new URL('../../../docs/evidence/apify/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  writeFileSync(`${directory}live-run.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  if (receipt.status !== 'complete' || !receipt.runId || !Array.isArray(receipt.signals) || receipt.signals.length === 0 || !receipt.chainValid) process.exitCode = 1;
}
