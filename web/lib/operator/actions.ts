import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getStateStore, runX402Console, type X402ConsoleRun } from '@backroom/orchestrator';
import { probeDependencies, type DemoStatus, type HealthRow } from '../../../tools/demo/health';
import { preflight } from '../../../orchestrator/src/demo-ops/preflight';
import { demoControl, operatorRoot } from './control';
import type { OperatorAction } from './catalog';

/** Nonzero proof exits are evidence, not transport errors. Never relay stderr or provider exceptions. */
export async function collectProofResult(child: ChildProcess, reportFile?: string) {
  const { stdout, exitCode } = await new Promise<{ stdout: string; exitCode: number }>((resolve, reject) => {
    let text = '';
    child.stdout?.on('data', chunk => { text += chunk; if (text.length > 2_000_000) child.kill(); });
    child.on('error', () => reject(new Error('OPERATOR_CLI_FAILED')));
    child.on('close', code => code === null ? reject(new Error('OPERATOR_CLI_FAILED')) : resolve({ stdout: text, exitCode: code }));
  });
  let report = stdout;
  if (reportFile) {
    try { report = await readFile(reportFile, 'utf8'); }
    catch { if (exitCode === 0) throw new Error('OPERATOR_REPORT_MISSING'); }
  }
  return { scope: 'Synthetic rehearsal; no dial, live bank writes or human approval. Historical evidence retains its date.',
    output: report.slice(0, 200_000) || 'No proof report was produced.', truncated: report.length > 200_000,
    exitCode, failed: exitCode !== 0 };
}

async function runCLI(action: 'core' | 'eval' | 'metrics' | 'scoreboard' | 'burst_plan' | 'burst') {
  const root = operatorRoot(), out = join(root, '.demo/operator', randomUUID());
  await mkdir(out, { recursive: true, mode: 0o700 });
  const scripts = { core: 'core-demo/cli.ts', eval: 'eval/cli.ts', metrics: 'metrics/cli.ts', scoreboard: 'agents/eval/scoreboard.ts', burst_plan: 'burst/cli.ts', burst: 'burst/cli.ts' };
  const args = action === 'burst_plan' ? ['--companies', '25', '--month', '2026-09', '--plan']
    : action === 'burst' ? ['--companies', '1', '--month', '2026-09', '--items-per-company', '1', '--concurrency', '1'] : [];
  const loader = createRequire(join(root, 'orchestrator/package.json')).resolve('tsx');
  const store = getStateStore();
  const signal = action === 'burst' ? AbortSignal.any([store.llmSignal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
  // No sponsor/cloud/voice credentials cross into offline processes. No shell, caller-selected args, or shared globals.
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
    STATE_STORE: 'memory', PRECALL_APIFY: 'fake', PRECALL_CRS: 'fake', GX10_ENABLED: 'false',
    BACKROOM_REPORT_DIR: out, GX10_BASE_URL: process.env.GX10_BASE_URL };
  const child = spawn(process.execPath, ['--import', loader, join(root, 'orchestrator/src', scripts[action]), ...args],
    { cwd: root, env, signal, stdio: ['ignore', 'pipe', 'ignore'] });
  return collectProofResult(child, action === 'metrics' ? join(out, 'metrics.md') : action === 'scoreboard' ? join(out, 'scoreboard.md') : undefined);
}
export async function runOperatorAction(action: OperatorAction): Promise<unknown> {
  if (action === 'llm_on' || action === 'llm_off') {
    await getStateStore().setLlmEnabled(action === 'llm_on');
    return { llmEnabled: getStateStore().llmEnabled };
  }
  if (action === 'status' || action === 'reset') return demoControl(action);
  // Signer stays server-side; the result carries only labels, public addresses, hashes and audit ids.
  if (action === 'x402_simulated' || action === 'x402_testnet' || action === 'x402_blocked') {
    return runX402Console(action.slice('x402_'.length) as X402ConsoleRun, getStateStore());
  }
  if (action === 'health' || action === 'preflight') {
    const status = await demoControl('status') as DemoStatus & { publicUrl: string };
    return action === 'preflight' ? preflight(process.env, status)
      : probeDependencies({ env: { ...process.env, DEMO_PUBLIC_URL: status.publicUrl }, status, live: true,
        hostRows: await demoControl('health') as HealthRow[] });
  }
  if (action === 'warm' || action === 'burst') {
    const state = getStateStore();
    if (process.env.BACKROOM_OPERATOR_LOCAL_MODELS !== '1' || !state.llmEnabled) throw new Error('LOCAL_MODELS_DISABLED');
    if (action === 'warm') {
      const response = await fetch(`${(process.env.GX10_BASE_URL || 'http://100.117.44.20:11434/v1').replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([state.llmSignal, AbortSignal.timeout(30_000)]),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer local' },
        body: JSON.stringify({ model: process.env.GX10_MODEL || 'gpt-oss:20b', messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1, stream: false }),
      });
      if (!response.ok) throw new Error('GX10_UNAVAILABLE');
      await response.json();
      return { localModelResponded: true, cloudFallback: false, policyDecision: false };
    }
  }
  return runCLI(action);
}
