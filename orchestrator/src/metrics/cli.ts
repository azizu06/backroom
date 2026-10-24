/** Offline metrics only: never dials, contacts a bank, or invokes a model. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runCoreDemo, runInboxTrap } from '../core-demo/core';
import { runNorthfieldPayables } from '../core-demo/northfield';
import { runEval } from '../eval/harness';
import { replayCorpus, type CorpusCase } from '../../../fixtures/redteam/replay';
import { benchmarkCases, renderBenchmark, type BenchmarkReceipt } from './inbox-benchmark';
import { existsSync } from 'node:fs';
import { auditMetrics, missing, renderRoutes, table, type AuditRun } from './report';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const json = (path: string) => JSON.parse(read(path));
const hash = (path: string) => createHash('sha256').update(read(path)).digest('hex');
const quote = (arg: string) => /^[a-zA-Z0-9_./:=+-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
const args = process.argv.slice(2).filter(arg => arg !== '--');

async function main() {
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--audit' || !args[i + 1]) throw new Error('Usage: pnpm metrics [--audit path.json ...]');
    files.push(args[++i]!);
  }
  globalThis.fetch = async () => { throw new Error('METRICS_NETWORK_FORBIDDEN'); };
  const runs: AuditRun[] = [];
  const rows: [string, string | number, string][] = [];
  let evalText = 'Not run: --audit selects saved audit evidence only.';
  if (files.length) {
    for (const path of files) {
      const saved = json(path);
      const entries = Array.isArray(saved) ? saved : saved.entries;
      if (!Array.isArray(entries)) throw new Error('Audit input must be an entry array or {kind, entries}');
      runs.push({ name: relative(root, resolve(root, path)), kind: ['live', 'simulated'].includes(saved.kind) ? saved.kind : 'unknown', routingOverride: saved.routingOverride === true, entries });
    }
  } else {
    const core = await runCoreDemo();
    runs.push({ name: 'demo:core collections', kind: 'simulated', entries: core.entries });
    for (const llmOff of [false, true]) {
      const trap = await runInboxTrap({ llmOff });
      runs.push({ name: `demo:core inbox LLM ${llmOff ? 'OFF' : 'ON'}`, kind: 'simulated', entries: trap.entries });
    }
    const ap = await runNorthfieldPayables();
    runs.push({ name: 'demo:core Northfield AP', kind: 'simulated', entries: ap.entries });
    const evaluation = await runEval();
    const reports = evaluation.reports;
    const policyReports = reports.filter(report => !report.outcome.startsWith('declared:') && report.outcome !== 'NONE');
    const matches = policyReports.filter(report => report.answerKeyMatch).length;
    const incomplete = reports.filter(report => report.seams.includes('integration:not_executed')).length;
    rows.push(['Answer-key policy-step match', `${matches}/${policyReports.length} (${(100 * matches / policyReports.length).toFixed(2)}%)`,
      `Fresh scripted eval: signoff=${evaluation.signoff}, gradedEval=${evaluation.gradedEval}; ${incomplete}/${reports.length} scenarios skip integration steps; integration-only scenarios excluded from this score. This is NOT final-state + evidence compliance.`],
    ['Answer-key final state + required evidence', missing('harness does not execute every integration step'), 'Do not compare the policy-step score with the ≥90% full text-sim target.'],
    ['Eval mismatches', reports.reduce((sum, report) => sum + report.violations.length, 0), 'Harness violations are answer-key mismatches, not unauthorized payment counts.'],
    ['Eval escalations', reports.reduce((sum, report) => sum + report.escalations.length, 0), 'Typed policy-step ESCALATE outcomes; separate from audit/replay counts.']);
    evalText = reports.map(report => `${report.id}: ${report.answerKeyMatch ? 'MATCH' : 'MISMATCH'}; ${report.outcome}${report.violations.length ? '; ' + report.violations.join('; ') : ''}`).join('\n');
    const corpus = read('fixtures/redteam/corpus.jsonl').trim().split('\n').map(line => JSON.parse(line) as CorpusCase);
    const replay = await replayCorpus(corpus);
    const probes = replay.flatMap(result => result.probes);
    rows.push(['Policy violation cases (red-team)', `${replay.filter(result => result.violations.length).length}/${replay.length}`,
      'Fresh deterministic API-boundary replay; typed probes, mock effects. NOT live spoken commitments or real transfers.'],
    ['Red-team failure cases', `${replay.filter(result => result.failures.length).length}/${replay.length}`, 'Failures retained, not filtered out.'],
    ['Red-team escalations', `${probes.filter(probe => probe.outcome === 'ESCALATE').length}/${probes.length} probes`,
      'Multiple seams per case; these are not distinct human approval requests.'],
    ['Red-team raw speech/inbox coverage gaps', replay.reduce((n, result) => n + result.coverageGaps.length, 0),
      'Language variants mapped to typed probes; live classifiers/transcripts not exercised.']);
  }
  const receipt = json('orchestrator/src/collections/live-receipt.json');
  if (!files.length) runs.push({ name: `Historical pre-call smoke (${receipt.measuredAt}; model live, CRS/Apify fake)`, kind: 'live', entries: receipt.audit });
  const metrics = auditMetrics(runs);
  const valid = metrics.checked.filter(run => run.status.valid);
  const entries = valid.flatMap(run => run.entries);
  const decisions = entries.filter(entry => entry.decision);
  rows.unshift(['Audit chain verification', `${valid.length}/${runs.length} valid; ${entries.length} accepted entries`, 'Canonical full chains checked from genesis. Invalid chains excluded from all aggregates.'],
    ['Audit escalations', entries.filter(entry => entry.decision === 'ESCALATE').length, 'Decision records, not deduplicated escalation rows or human approvals.'],
    ['Audit escalations per 100 policy decisions', decisions.length ? (100 * decisions.filter(entry => entry.decision === 'ESCALATE').length / decisions.length).toFixed(2) : missing('no policy decisions'), 'Explicit denominator: decision-bearing audit entries; not all agent actions.']);
  const benchmarkPath = 'docs/evidence/inbox-benchmark/receipt.json';
  const benchmark = existsSync(resolve(root, benchmarkPath)) ? json(benchmarkPath) as BenchmarkReceipt : undefined;
  if (benchmark && benchmark.results.length !== benchmarkCases().length * 2) throw new Error('Incomplete benchmark receipt');
  const benchmarkText = benchmark ? renderBenchmark(benchmark) : 'Raw inbox benchmark not measured: no retained receipt.';
  rows.push(['Policy violations (live end-to-end)', missing('no joined effect/approval receipts or complete speech transcript'), 'DENY/ESCALATE attempts are not violations. A hash-valid audit alone does not prove matching authorization.'],
    ['Human approvals per 100 actions', missing('audit decision rows are not unique actions or completed human approvals'), 'Do not substitute escalation record counts for actual controller work.'],
    ['Planted traps caught / false holds', benchmark ? 'Measured ON/OFF by cohort below' : missing('raw inbox receipt absent'), 'Raw inbox safety holds; separate from complete final-state + integration compliance.'],
    ['Live completed model local share (C2)', metrics.localShare, 'Counts local + gx10_fallback / all completed model decisions in verified live chains; corpus generation excluded.'],
    ['Estimated model cost per completed decision', metrics.costPerDecision === undefined ? missing('no verified live model decisions') : `$${metrics.costPerDecision.toFixed(6)}`, 'Mean recorded costUsd; estimates exclude hardware/electricity, telephony, failed requests and retries.'],
    ['GX10 → cloud fallback events', metrics.models.length ? metrics.fallbacks : missing('no verified live model decisions'), 'route=cloud_fallback; gx10_fallback is the opposite direction (cloud → GX10).']);

  // Historical receipts are kept separate from fresh chain-derived aggregates.
  const smoke = json('fixtures/t10/router-smoke.json');
  const t1 = read('docs/t1-cartesia.md');
  const connection = t1.match(/Time to connection is ([\d.]+) s/);
  rows.push(['Pre-call pipeline p50 (recorded live-model smoke)',
    Number.isFinite(receipt.latencyMs) ? `${receipt.latencyMs.toFixed(2)} ms (n=1)` : missing('no pipeline duration'),
    `Historical ${receipt.measuredAt}; model=${receipt.services.model}, CRS=${receipt.services.crs}, Apify=${receipt.services.apify}, dial=${receipt.services.dial}. Not a live end-to-end pipeline benchmark.`],
    ['Call ring time', missing('phone-owner ring confirmation not recorded'), connection ? `docs/t1-cartesia.md reports ${connection[1]} s to connection (upper bound on ring), not exact ring latency.` : 'No connection upper bound found in docs/t1-cartesia.md.'],
    ['Voice turn latency p50/p90', missing('no user-turn-end → audio samples'), 'T1 tool/receiver timing is not voice response latency.'],
    ['Disclosure compliance / wrong-person leakage', missing('no complete transcript compliance evaluator'), 'T1 welcome was interrupted; configuration does not prove delivery.'],
    ['Prompt-only baseline violations', missing('baseline on C03/C04/C18/P03/P09 not run'), 'No comparison claim.'],
    ['T10 successful live fallback smoke', smoke.status, `Recorded ${smoke.measuredAt}: ${smoke.error ?? 'no error recorded'}. ${smoke.note}`]);
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const report = [
    '# Proof-it-works metrics', '', `Generated: ${new Date().toISOString()}`, `Source git SHA: \`${sha}\` (report/tool changes may be uncommitted at generation time).`,
    `Exact command (repository root): \`pnpm metrics${args.length ? ' ' + args.map(quote).join(' ') : ''}\``, '',
    files.length ? 'Refs #29 #32; spec §7.2. Saved-run mode verifies retained audit chains without network calls. Live service scope and simulation boundaries are documented in [receipt notes](evidence/live-run/README.md); the live-model sample uses an explicit GX10-only operator override. Historical service receipts are labeled separately.' : 'Refs #29 #32; spec §7.2. Default command runs the current core-demo, scripted eval and frozen red-team replay offline. It never calls a model, bank or phone. Fresh policy/gateway/StateStore/crypto behavior is real; company, speech, sponsor transports, payment effects and software passkeys are simulated. Historical service receipts are labeled separately.', '',
    table(rows), '', benchmarkText, '', '## Live model route measurements', '', renderRoutes(metrics), '',
    'No samples means not measured, not zero latency/cost. Nearest-rank percentiles include all samples and outliers. Route rows count completed audited decisions, not underlying HTTP attempts. Scenario-suite C2 attainment is unverified even when an isolated live smoke succeeds.', '',
    '## Audit provenance', '', table(metrics.checked.map(run => [run.name, run.status.valid ? `${run.entries.length} entries; ${run.kind}` : `INVALID at ${run.status.firstBrokenSeq}: ${run.status.reason}`,
      `head=${run.status.headHash}`])), '',
    '## Reproduction and interpretation', '',
    '- Saved runs: `pnpm metrics --audit path.json --audit other.json`. Each file is a full genesis chain array, or `{ "kind": "live" | "simulated", "entries": [...] }`. Bare arrays have unknown provenance and do not establish live model share. Caller-supplied provenance is an assertion, not cryptographic proof. Each file is a separate run; do not supply overlapping snapshots of the same run.',
    '- Every invocation overwrites `docs/metrics.md` and prints this same Markdown. Saved-run mode skips fresh demo/eval/replay; historical receipt rows retain their original dates. Malformed inputs fail; invalid chains remain visible and are excluded.',
    '- The frozen red-team corpus was generated on GX10, but its generation calls are not office decisions and do not contribute to C2. Replay records multiple seams per case, so counts must not be added to eval or demo as unique scenarios.',
    '- Bad historical results remain in [red-team evidence](redteam.md): before the fixes, 20 failure cases and 10 mock violation cases. Current results do not erase those findings.',
    '- Live rehearsal scope, operator routing override, sandbox idempotency and reproduction: [receipt notes](evidence/live-run/README.md). An operator-forced local sample does not establish production C2 attainment.',
    '- Raw inbox safety benchmark: `INBOX_BENCHMARK_LIVE=1 pnpm --filter @backroom/orchestrator exec tsx src/metrics/inbox-live.ts ../docs/evidence/inbox-benchmark/receipt.json`; run via `gx10 run` on the GX10. Exact inputs and per-case full audit chains are in [receipt](evidence/inbox-benchmark/receipt.json); scope and limitations in [notes](evidence/inbox-benchmark/README.md). `pnpm metrics` reads this receipt offline in both modes.',
    '- Sources: [answer key](../fixtures/answer-key/expected.json), [T1 voice](t1-cartesia.md), [pre-call receipt](../orchestrator/src/collections/live-receipt.json), [T10 router smoke](../fixtures/t10/router-smoke.json).', '',
    `Answer-key SHA-256: \`${hash('fixtures/answer-key/expected.json')}\``, `Corpus SHA-256: \`${hash('fixtures/redteam/corpus.jsonl')}\``, '',
    '<details><summary>Fresh policy-step eval details (not full final-state grading)</summary>', '', '```text', evalText, '```', '', '</details>', '',
  ].join('\n');
  writeFileSync(resolve(root, 'docs/metrics.md'), report);
  console.log(report);
}
main().catch(error => {
  console.error(error instanceof Error && error.message.startsWith('Usage:') ? error.message : 'Metrics failed reading or replaying evidence; no report written.');
  process.exitCode = 1;
});
