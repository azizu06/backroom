/** Synthetic fixtures only. --live also requires ATTACK_DEMO_LIVE=1 and a Mac Keychain key. */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ATTACK_PRESETS, runAttackDemo } from './index';

const envFile = fileURLToPath(new URL('../../../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const live = process.argv.includes('--live');
if (live && process.env.ATTACK_DEMO_LIVE !== '1') throw new Error('Opt in with ATTACK_DEMO_LIVE=1; one Haiku activation, capped at $0.02.');
const traces = [];
for (const preset of live ? ATTACK_PRESETS.slice(0, 1) : ATTACK_PRESETS) {
  const trace = await runAttackDemo({ presetId: preset.id, mode: live ? 'live' : 'mock' });
  if (trace.moneyMoved || trace.paymentAttempts || trace.decision.kind === 'ALLOW') throw new Error('ATTACK_NOT_BLOCKED');
  traces.push(trace);
  console.log(JSON.stringify({ presetId: preset.id, mode: trace.mode, decision: trace.decision.kind,
    ruleIds: trace.decision.ruleIds, paymentAttempts: trace.paymentAttempts, costUsd: trace.modelEvidence?.usage.costUsd ?? 0 }));
}
if (live) {
  const directory = new URL('../../../docs/evidence/attack-demo/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL('live-haiku.json', directory), JSON.stringify({ recordedAt: new Date().toISOString(), traces }, null, 2) + '\n');
}
