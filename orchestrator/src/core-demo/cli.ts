import { createStateStoreFromEnv, getStateStore, SpacetimeStateStore } from '../index';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createReplayRecorder, parseReplay } from '../replay/record';
import { MemoryStateStore } from '../store';
import { fileURLToPath } from 'node:url';
import { runNorthfieldPayables } from './northfield';
import { runCoreDemo, runInboxTrap } from './core';
import type { DemoBank } from './bank';

async function main() {
  const args = process.argv.slice(2);
  const recordIndex = args.indexOf('--record');
  const recordName = recordIndex >= 0 ? args[recordIndex + 1] : undefined;
  const remaining = args.filter((_, index) => index !== recordIndex && (recordIndex < 0 || index !== recordIndex + 1));
  if (remaining.some(arg => arg !== '--live') || (recordIndex >= 0 && (!recordName || !/^[a-zA-Z0-9_-]{1,64}$/.test(recordName)))
    || (recordName && args.includes('--live'))) throw new Error('Usage: pnpm demo:core [--live | --record <name>]');
  // Deliberately pace this synthetic run while recording; frame times are actual capture times.
  const recorder = recordName ? createReplayRecorder({ name: recordName, paceMs: 180 }) : undefined;
  let bank: DemoBank | undefined;
  let accountId: string | undefined;
  if (args.includes('--live')) {
    const env = new URL('../../../../.env.local', import.meta.url);
    if (existsSync(env)) process.loadEnvFile(fileURLToPath(env));
    if (!process.env.NESSIE_API_KEY) throw new Error('LIVE_NESSIE_KEY_REQUIRED: --live needs NESSIE_API_KEY');
    const module = await import('@backroom/nessie');
    const claims = new module.FileClaims(process.env.NESSIE_CLAIMS_DIR ?? fileURLToPath(new URL('../../../../.nessie-state/claims', import.meta.url)));
    const client = new module.NessieClient({ apiKey: process.env.NESSIE_API_KEY, claims });
    bank = client;
    accountId = process.env.NESSIE_ACCOUNT_ID;
    if (!accountId) accountId = (await module.seedNorthfield(client, claims)).account._id;
    console.log('LIVE Nessie sandbox ONLY. Card, call, controller authenticator and external pre-call checks remain simulated.');
  }
  console.log('MOMENT 1 | 3D closed | policy + gateway + payment service + reconciliation + StateStore real; external transports fake by default');
  const stores: SpacetimeStateStore[] = [];
  const demoStore = (suffix = '') => {
    if (process.env.STATE_STORE !== 'spacetime') return undefined;
    const store = suffix ? createStateStoreFromEnv({ ...process.env, SPACETIMEDB_DATABASE: `${process.env.SPACETIMEDB_DATABASE}${suffix}` }) : getStateStore();
    if (store instanceof SpacetimeStateStore) stores.push(store);
    return store;
  };
  const recordedState = (phase: string, suffix = '') => {
    const store = demoStore(suffix);
    return recorder ? recorder.attach(store ?? new MemoryStateStore(), phase) : store;
  };
  try {
    const run = await runCoreDemo({ store: recordedState('collections-1042'), bank, accountId, ...(bank && { bankLabel: 'live_nessie_sandbox' }) });
    for (const line of run.transcript) console.log(line);
    console.log(`AUDIT chain valid=${run.chainValid}; gateway IDs retained in refs; why IDs audit_N alias audit:N`);
    for (const entry of run.entries) console.log(JSON.stringify(entry));
    for (const [index, answer] of run.answers.entries()) console.log(`ASK WHY ${index + 1} (${answer.source}): ${answer.answer}`);
    for (const llmOff of [false, true]) {
      const trap = await runInboxTrap({ llmOff, store: recordedState(llmOff ? 'inbox-llm-off' : 'inbox-llm-on', llmOff ? '-off' : '-on') });
      console.log(`MOMENT 2 | LLM ${llmOff ? 'OFF' : 'ON (no model needed)'} | #4471 lookalike + bank-change hold`);
      console.log(JSON.stringify(trap));
      if (!trap.chainValid) throw new Error('CORE_DEMO: invalid trap audit chain');
    }
    const ap = await runNorthfieldPayables({ state: recordedState('northfield-ap', '-ap') });
    console.log('NORTHFIELD AP | ' + JSON.stringify(ap));
    if (!run.chainValid) throw new Error('CORE_DEMO: invalid collection audit chain');
    if (recorder && recordName) {
      const jsonl = recorder.toJsonl();
      const verified = parseReplay(jsonl);
      const directory = new URL('../../../fixtures/replays/', import.meta.url);
      mkdirSync(directory, { recursive: true });
      writeFileSync(new URL(`${recordName}.jsonl`, directory), jsonl, { flag: 'wx' });
      console.log(`REPLAY saved: fixtures/replays/${recordName}.jsonl; ${verified.frames.length} frames, ${verified.durationMs} ms; synthetic, never live.`);
    }
  } finally { await Promise.all(stores.map(store => store.close())); }
  console.log('PASS: core loop, both bank-change traps, LLM OFF and audit chains. Synthetic run; phone/human-passkey/T4 live gates remain separate.');
}
main().catch(error => {
  // Never dump upstream exceptions, fetch URLs, request bodies or keys.
  const message = error instanceof Error && /^(CORE_DEMO:|LIVE_NESSIE_|Usage:)/.test(error.message)
    ? error.message : 'Core demo failed at an adapter boundary; check service setup (provider details withheld).';
  console.error(message); process.exitCode = 1;
});
