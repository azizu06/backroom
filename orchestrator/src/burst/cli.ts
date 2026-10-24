/** The only opt-in live entry point for the burst; unit tests never use the network. */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generateMonth, runBurst } from './index';

const help = `GX10-only synthetic inbox burst (opt-in; no cloud, live bank writes or dial).
  pnpm demo:burst -- --companies 25 --month 2026-09
  --concurrency 2           company workers, 1..8; use 2 on the shared GX10
  --model gpt-oss:20b       qwen3:8b, gpt-oss:20b, or gpt-oss:120b
  --items-per-company N    truncate for a small live smoke; default all 37
  --input-usd-per-million N --output-usd-per-million N
                           optional comparison rates; no implied provider price
  --plan                   generate manifest/receipt only; no GX10/model requests
Receipts: .demo/burst/<run-id>/{manifest.json,events.jsonl,summary.json}
`;
async function main() {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.includes('--help')) { console.log(help); return; }
  const values = new Map<string, string>();
  let plan = false;
  const allowed = new Set(['--companies', '--month', '--concurrency', '--model', '--items-per-company', '--input-usd-per-million', '--output-usd-per-million']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === '--plan') { plan = true; continue; }
    if (!allowed.has(flag) || !args[i + 1] || args[i + 1]!.startsWith('--') || values.has(flag)) throw new Error('Invalid/duplicate option; use --help');
    values.set(flag, args[++i]!);
  }
  const companies = Number(values.get('--companies') ?? 25), month = values.get('--month') ?? '2026-09';
  const concurrency = Number(values.get('--concurrency') ?? 2), model = values.get('--model') ?? 'gpt-oss:20b';
  const limit = Number(values.get('--items-per-company') ?? 37);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('concurrency must be 1..8');
  if (!Number.isInteger(limit) || limit < 1 || limit > 37) throw new Error('items-per-company must be 1..37');
  if (!['qwen3:8b', 'gpt-oss:20b', 'gpt-oss:120b'].includes(model)) throw new Error('Unsupported GX10 model');
  const inputRate = values.has('--input-usd-per-million') ? Number(values.get('--input-usd-per-million')) : undefined;
  const outputRate = values.has('--output-usd-per-million') ? Number(values.get('--output-usd-per-million')) : undefined;
  for (const rate of [inputRate, outputRate]) if (rate !== undefined && (!Number.isFinite(rate) || rate < 0)) throw new Error('Invalid comparison rate');
  const manifest = generateMonth(companies, month).filter((_, i) => i % 37 < limit);
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const output = join(root, '.demo', 'burst', `${Date.now()}-${randomUUID().slice(0, 8)}`);
  mkdirSync(output, { recursive: true, mode: 0o700 });
  writeFileSync(join(output, 'manifest.json'), JSON.stringify({ sourceSha, month, generation: 'deterministic Northfield clones and frozen redteam; not a novel business population', manifest }, null, 2), { mode: 0o600, flag: 'wx' });
  const events = join(output, 'events.jsonl');
  const emit = (event: Record<string, unknown>) => {
    appendFileSync(events, JSON.stringify({ at: new Date().toISOString(), sourceSha, ...event }) + '\n', { mode: 0o600 });
    if (event.type !== 'item') console.log(JSON.stringify(event));
  };
  console.log(`Synthetic burst receipts: ${output}`);
  if (plan) { emit({ type: 'plan', companies, month, total: manifest.length, concurrency, model, inference: 'not run' }); return; }
  try {
    // Fail closed when the shared GPU preflight is unavailable; never start/stop models.
    const gpu = execFileSync('gx10', ['gpu'], { encoding: 'utf8', timeout: 20000 });
    console.log(gpu);
    emit({ type: 'gpu_preflight', output: gpu });
    const result = await runBurst(manifest, { concurrency, model, emit, inputUsdPerMillion: inputRate, outputUsdPerMillion: outputRate });
    writeFileSync(join(output, 'summary.json'), JSON.stringify({ sourceSha, month, model, ...result }, null, 2), { mode: 0o600, flag: 'wx' });
    if (result.failedItems || result.trapsCaught < result.trapsTotal || result.trapRuleMatches < result.ruleTrapsTotal) process.exitCode = 1;
  } catch {
    emit({ type: 'fatal', error: 'BURST_FAILED; check GX10 connectivity/GPU preflight and local receipt permissions' });
    process.exitCode = 1;
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'BURST_FAILED'); process.exitCode = 1; });
