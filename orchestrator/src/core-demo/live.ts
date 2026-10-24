/** Opt-in integration rehearsal: owned demo DB server + GX10 + Nessie sandbox. Never dials. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { FileClaims, NessieClient, seedNorthfield } from '@backroom/nessie';
import { SpacetimeStateStore } from '../spacetime-store';
import { createCallPlanner } from '../collections';
import { askWhy } from '../why';
import { isLlmOff, type RouteResult } from '../router';
import { runCoreDemo, runInboxTrap, verifyChain } from './core';
import { createGx10RehearsalRouter } from './live-router';
import { createNorthfieldRepository, northfieldInvoice, northfieldSource, PayablesSeat } from '../payables';
import { processInbox } from '../payables/inbox';
import type { Decision } from '@backroom/policy';

const root = fileURLToPath(new URL('../../../', import.meta.url));
process.chdir(root);
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
async function main() {
  assert(process.argv.includes('--confirm-sandbox'), 'REHEARSAL: pass --confirm-sandbox');
  assert(process.env.NESSIE_API_KEY, 'REHEARSAL: missing Nessie key');
  const owner = JSON.parse(readFileSync('.demo/process.json', 'utf8'));
  const status = await fetch(`http://127.0.0.1:${owner.port}/status`, { headers: { authorization: `Bearer ${owner.token}` } });
  assert(status.ok && (await status.json() as { stateStore: string }).stateStore === 'spacetime', 'REHEARSAL: start demo:up with SpacetimeDB first');
  const statePort = Number(process.env.DEMO_STATE_PORT || 3115);
  const cli = process.env.SPACETIME_CLI || resolve('.demo/spacetime/spacetime');
  const cliRoot = process.env.SPACETIME_ROOT || resolve('.demo/spacetime');
  const config = resolve('.demo/publisher.toml');
  const token = /^spacetimedb_token\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1];
  assert(token, 'REHEARSAL: owned publisher missing');
  const measuredAt = new Date().toISOString();
  const out = resolve('docs/evidence/live-run', measuredAt.replaceAll(':', '-'));
  mkdirSync(out, { recursive: true });
  const stores: SpacetimeStateStore[] = [];
  const auditFiles: string[] = [];
  let collectionsDatabase = '';
  const save = async (phase: string, store: SpacetimeStateStore) => {
    const entries = await store.listAudit(); assert(verifyChain(entries), 'REHEARSAL: invalid full chain');
    const path = resolve(out, `${phase}.audit.json`); auditFiles.push(path.slice(root.length));
    writeFileSync(path, JSON.stringify({ kind: 'live', routingOverride: true, services: { state: 'local_spacetime', model: 'GX10_only', bank: 'Nessie_sandbox', voice: 'scripted_no_dial', controller: 'software_test_authenticator', crs: 'fake', apify: 'fake' }, entries }, null, 2) + '\n');
  };
  const store = async (phase: string) => {
    const database = `backroom-live-${Date.now()}-${phase}`;
    execFileSync(cli, [`--root-dir=${cliRoot}`, `--config-path=${config}`, 'publish', database, '--server', `http://127.0.0.1:${statePort}`, '--module-path', 'spacetime', '--yes'], { stdio: 'pipe', timeout: 120000 });
    if (phase === 'collections') collectionsDatabase = database;
    const result = new SpacetimeStateStore({ uri: `ws://127.0.0.1:${statePort}`, database, token });
    stores.push(result); await result.ready; await result.setLlmEnabled(true); return result;
  };
  try {
    const collections = await store('collections');
    const modelRoute = createGx10RehearsalRouter(collections, async (url, init) => {
      const start = performance.now();
      const response = await fetch(url, init);
      const body = await response.clone().json();
      appendFileSync('.demo/live-model-trace.jsonl', JSON.stringify({ model: JSON.parse(String(init?.body)).model, status: response.status, latencyMs: performance.now() - start, body }) + '\n', { mode: 0o600 });
      return response;
    });
    const bankRequests: { method: string; path: string; status: number; elapsedMs: number }[] = [];
    const claims = new FileClaims(process.env.NESSIE_CLAIMS_DIR || resolve('.nessie-state/claims'));
    const bank = new NessieClient({ apiKey: process.env.NESSIE_API_KEY!, claims, observe: ({ method, path, status, elapsedMs }) => { bankRequests.push({ method, path, status, elapsedMs }); } });
    const accountId = process.env.NESSIE_ACCOUNT_ID || (await seedNorthfield(bank, claims)).account._id;
    const run = await runCoreDemo({ store: collections, bank, accountId, bankLabel: 'LIVE Nessie sandbox', now: Date.now,
      planner: createCallPlanner({ cloudRoute: modelRoute }) });
    writeFileSync('.demo/live-core-checkpoint.json', JSON.stringify({ collection: run.collection, whyEntries: run.whyEntries, database: collectionsDatabase, measuredAt }));
    console.log('Moment 1: policy/core/gateway, GX10 plan, software passkey denial, sandbox deposit/reconcile PASS');
    const samples: RouteResult[] = [];
    const answer = await askWhy('Why was the fee waiver for 1042 denied?', run.whyEntries, { stateStore: collections,
      modelRoute: async (task, input, schema) => {
        const result = await modelRoute(task, input, schema); if (!isLlmOff(result)) samples.push(result); return result;
      } });
    writeFileSync('.demo/live-why-result.json', JSON.stringify({ answer, samples }, null, 2));
    assert(answer.citations.length > 0, 'REHEARSAL: why did not produce validated citations');
    console.log(`Moment 3: cited why source=${answer.source}; completed routed outputs=${samples.length}`);
    for (const result of answer.source === 'model' ? samples.slice(-1) : []) await collections.appendAudit({ ts: Date.now(), actor: 'local_model', seat: 'collections', action: 'ask_why_rehearsal',
      ruleIds: [], policyVersion: 1, refs: answer.citations, route: result.route, latencyMs: result.latencyMs, costUsd: result.costUsd,
      inputs: { model: result.model, answer, operatorOverride: 'GX10-only rehearsal; cloud disabled' } });
    await save('collections', collections);
    const traps = [];
    for (const llmOff of [false, true]) {
      const state = await store(llmOff ? 'off' : 'inbox');
      const route = createGx10RehearsalRouter(state);
      if (llmOff) await state.setLlmEnabled(false);
      const trap = await runInboxTrap({ llmOff, store: state });
      const repo = await createNorthfieldRepository();
      const controller = { request: async (decision: Decision, refs: string[]) => {
        assert(decision.kind === 'ESCALATE');
        const id = `live-inbox:${refs[0]}`;
        return (await state.createCallEscalation({ id, taskId: id, fromAgent: id, seat: 'payables', toHuman: decision.toHuman,
          ruleIds: decision.ruleIds, evidenceRefs: refs, policyVersion: decision.policyVersion, quote: decision.quote }, Date.now())).id;
      } };
      const payables = new PayablesSeat({ state, repository: repo, controller });
      const results = [];
      for (const id of ['4419', '4471']) {
        const fields = northfieldInvoice(id), source = northfieldSource(id);
        const result = await processInbox({ id: `judge-${id}`, source: 'judge', senderDomain: source.senderDomain, kind: 'invoice',
          text: JSON.stringify(fields) }, { state, controller, payables, modelRoute: route,
          vendor: { propose: async () => { throw new Error('REHEARSAL: unexpected vendor dispatch'); } } });
        assert(result.status === 'held', 'REHEARSAL: inbox trap escaped hold');
        results.push({ id, status: result.status, rules: result.decision.ruleIds });
      }
      const offAnswer = llmOff ? await askWhy('Why was 1042 denied?', run.whyEntries, { stateStore: state, modelRoute: route }) : undefined;
      if (llmOff) assert(offAnswer?.source === 'fallback');
      traps.push({ llmOff, typedTrap: { rules: trap.decision?.ruleIds, bankChangeRules: trap.bankChangeDecision.ruleIds, bankEffects: trap.bankEffects, modelRequests: trap.modelRequests }, extractedTraps: results, offAnswer });
      await save(llmOff ? 'off' : 'inbox', state);
      console.log(`Moment 2 / OFF=${llmOff}: traps held; scripted bank effects=0`);
    }
    const entries = await collections.listAudit();
    const receipt = { measuredAt, services: { models: 'GX10-only operator override; 120b hard tasks, 20b extraction', state: 'real local SpacetimeDB', bank: 'live Nessie sandbox; posted-deposit display is not settlement', voice: 'scripted turns; no Cartesia dial', controller: 'real verifier/software test authenticator', crs: 'fake', apify: 'fake' },
      collection: run.collection, controller: { status: run.controllerRow.status, method: run.controllerRow.method },
      bankRequests, bankEvidence: entries.filter(entry => /payment|reconcil/.test(entry.action)), answer, traps, auditFiles };
    writeFileSync(resolve(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(`Saved redacted live receipts: ${out.slice(root.length)}`);
    console.log(`Run pnpm metrics ${auditFiles.map(path => `--audit ${path}`).join(' ')}`);
  } finally { await Promise.all(stores.map(store => store.close())); }
}
main().catch(error => { writeFileSync('.demo/live-error.txt', error instanceof Error ? error.stack ?? error.message : 'Unknown error', { mode: 0o600 }); console.error(error instanceof Error && error.message.startsWith('REHEARSAL:') ? error.message : 'REHEARSAL failed; provider details withheld. Inspect private local state; never retry an ambiguous bank POST directly.'); process.exitCode = 1; });
