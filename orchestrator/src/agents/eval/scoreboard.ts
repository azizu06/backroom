import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { northfield, northfieldInvoice } from '../../payables';
import { runEval, scriptedPersona } from '../../eval/harness';
import { runInvoice, runReceivable, runCollectionsPermit } from './chain';
import { score, type Observation } from './score';

// All outbound network attempts fail closed, including accidental provider calls in future adapters.
globalThis.fetch = async () => { throw new Error('EVAL_NETWORK_FORBIDDEN'); };

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const sha = (path: string) => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
const command = 'pnpm --filter @backroom/orchestrator exec tsx src/agents/eval/scoreboard.ts';
const key = read('fixtures/answer-key/expected.json');
const manifest = read('fixtures/answer-key/frozen-manifest.json');
const manifestMismatches = Object.entries(manifest.sha256).filter(([path, expected]) => sha(`fixtures/${path}`) !== expected).map(([path]) => path);
if (manifestMismatches.length) throw new Error(`FROZEN_MANIFEST_MISMATCH:${manifestMismatches.join(',')}`);
const apScenarios = read('fixtures/scenarios/payables.json');
const arScenarios = read('fixtures/scenarios/collections.json');
const observations: Observation[] = [];
const invoiceRuns = [];
const gaps: { id: string; detail: string }[] = [];
let fieldCorrect = 0, fieldTotal = 0;
const fieldsToScore = ['invoiceId', 'vendorId', 'poId', 'amountCents', 'currency', 'lineItems', 'bankAccountId', 'adjustmentCents'];

// Every AP item, including historical invoices, gets an isolated snapshot. Historical invoices must not debit again.
for (const invoice of northfield.apInvoices) {
  const run = await runInvoice(invoice.id);
  const expected = northfieldInvoice(invoice.id);
  const fieldMismatches: string[] = [];
  for (const name of fieldsToScore) {
    const actual = run.extraction as Record<string, unknown> | undefined;
    const wanted = expected as unknown as Record<string, unknown>;
    fieldTotal++;
    if (JSON.stringify(actual?.[name]) === JSON.stringify(wanted[name])) fieldCorrect++;
    else fieldMismatches.push(name);
  }
  invoiceRuns.push({ ...run, trace: undefined, extraction: undefined, fieldMismatches,
    tools: run.trace.map(row => `${row.role}.${row.tool}`) });
  if (run.actual === 'ERROR') gaps.push({ id: `ap:${invoice.id}`, detail: `Runtime ${run.runtime.status}: ${run.runtime.reason}` });
}

// Use only explicit key labels for accuracy: the other AP invoices do not have per-item expected decisions.
const gradedAP = [];
for (const scenario of apScenarios) {
  const entry = key.payables[scenario.id];
  for (const [index, step] of scenario.steps.entries()) {
    const expected = entry.expectedSteps[index];
    const invoiceId = step.invoiceId ?? (step.action === 'propose_bank_change'
      ? scenario.steps.find((row: any) => row.invoiceId)?.invoiceId : undefined);
    if (!invoiceId || (step.verificationLayer === 'integration' && step.operation !== 'vendor_evidence_gate') ||
        (step.verificationLayer === 'policy' && (step.action !== 'propose_bank_change' && (step.badge !== 'payables' || step.action !== 'pay_invoice')))) continue;
    const run = await runInvoice(invoiceId, { caseId: `${scenario.id}:${index}`,
      pendingBankChange: step.vendorOverrides?.pendingBankChange,
      senderDomain: step.vendorOverrides?.sourceDomain });
    const wanted = step.operation === 'vendor_evidence_gate' ? 'HOLD' : expected.kind === 'ALLOW' ? 'ALLOW' : 'HOLD';
    const observation: Observation = { id: `${scenario.id}/${index}`, expected: wanted, actual: run.actual,
      fraud: expected.ruleIds?.includes('LOOKALIKE_DOMAIN') ?? false,
      duplicate: expected.ruleIds?.includes('DUPLICATE_INVOICE') ?? false };
    observations.push(observation);
    const actualRules = (run.assessment.ruleIds ?? run.vendorDecision?.ruleIds ?? run.vendor.ruleIds ?? []) as string[];
    const reportedSignalRules = (run.assessment.ruleIds ?? run.vendor.ruleIds ?? []) as string[];
    const exactRuleMatch = expected.ruleIds ? JSON.stringify(actualRules) === JSON.stringify(expected.ruleIds) : null;
    gradedAP.push({ ...observation, invoiceId, expectedRules: expected.ruleIds ?? ['VENDOR_UNVERIFIED workflow gate'],
      actualRules, reportedSignalRules, exactRuleMatch, runtime: run.runtime, mockDebits: run.mockDebits });
    if (exactRuleMatch === false) gaps.push({ id: observation.id,
      detail: `Expected rules [${expected.ruleIds}]; authoritative code decision returned [${actualRules}].` });
    if (expected.ruleIds && JSON.stringify(reportedSignalRules) !== JSON.stringify(expected.ruleIds)) gaps.push({ id: `${observation.id}:signals`,
      detail: `Tool signal list [${reportedSignalRules}] differs from key [${expected.ruleIds}]; authoritative sealed decision is [${actualRules}]. Signal lists and decision rules are distinct.` });
  }
}

const permits = [];
for (const scenario of arScenarios) {
  const step = scenario.steps.find((row: any) => row.actionRequest?.type === 'call_client');
  const run = await runCollectionsPermit(scenario.id, scenario.invoiceId, step?.contextOverrides);
  const index = scenario.steps.indexOf(step);
  const expected = index >= 0 ? key.collections[scenario.id].expectedSteps[index] : undefined;
  const match = expected ? run.result.decision === expected.kind &&
    JSON.stringify(run.result.ruleIds) === JSON.stringify(expected.ruleIds) : null;
  permits.push({ id: scenario.id, result: run.result, expected: expected ?? null, match,
    scope: expected ? 'keyed pre-call permit' : 'unscored baseline permit; conversation outcome is in legacy eval' });
  if (match === false) gaps.push({ id: scenario.id, detail: 'Collections permit disagrees with key.' });
}
const receivables = [];
for (const invoice of northfield.arInvoices) {
  const run = await runReceivable(invoice.id);
  const scenario = arScenarios.find((row: any) => row.invoiceId === invoice.id &&
    ['C06', 'C19', 'C20'].includes(row.id)) ?? (invoice.id === '1042' ? arScenarios.find((row: any) => row.id === 'C07') : undefined);
  const expected = scenario ? key.collections[scenario.id].plantedRule : null;
  const actual = run.result.decision === 'ALLOW' ? 'EXACT_PAYMENT_MATCH' : run.result.ruleId;
  receivables.push({ id: invoice.id, scenarioId: scenario?.id ?? null, expected, actual, match: expected ? expected === actual : null,
    result: run.result, audit: run.audit, tools: run.trace.map(row => `${row.role}.${row.tool}`) });
  if (expected && expected !== actual) gaps.push({ id: scenario.id, detail: `Reconciler expected ${expected}, got ${actual}.` });
}
const legacy = await runEval({ persona: scriptedPersona });
for (const row of legacy.reports) {
  for (const violation of row.violations) gaps.push({ id: row.id, detail: `Existing eval: ${violation}` });
  if (row.seams.includes('integration:not_executed')) gaps.push({ id: row.id, detail: 'At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.' });
}
gaps.push({ id: 'AR_RUNTIME', detail: 'AR probes exercise real specialist DomainTools with a Collections reducer lease, but do not drive the dispatcher/post-call role or a voice conversation. Those end-to-end runtime outcomes remain unmeasured.' });
const metrics = score(observations);
const fraction = (n: number, d: number) => ({ numerator: n, denominator: d, percent: d ? Number((100 * n / d).toFixed(2)) : null });
const rates = {
  extractionMockFieldFidelity: fraction(fieldCorrect, fieldTotal),
  sourceDocumentExtractionAccuracy: { numerator: null, denominator: null, percent: null, reason: 'No model reads PDFs; mock candidates are fixture-fed.' },
  ...metrics,
  exactAPRules: fraction(gradedAP.filter(row => row.exactRuleMatch === true).length, gradedAP.filter(row => row.exactRuleMatch !== null).length),
  collectionsPermits: fraction(permits.filter(row => row.match === true).length, permits.filter(row => row.match !== null).length),
  reconciliation: fraction(receivables.filter(row => row.match === true).length, receivables.filter(row => row.match !== null).length),
  legacyKeyChecks: fraction(legacy.reports.filter(row => row.answerKeyMatch).length, legacy.reports.length),
  legacyCompleteScenarios: fraction(legacy.reports.filter(row => row.answerKeyMatch && !row.seams.includes('integration:not_executed')).length, legacy.reports.length),
};
const report = {
  schemaVersion: 1, mode: 'deterministic-mock', command,
  provenance: { frozenManifestVerifiedFiles: Object.keys(manifest.sha256).length, baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    inputs: Object.fromEntries(['fixtures/company/northfield.json', 'fixtures/answer-key/expected.json',
      'fixtures/answer-key/frozen-manifest.json', 'fixtures/scenarios/payables.json', 'fixtures/scenarios/collections.json'].map(path => [path, sha(path)])),
    keyVersion: key.version, signoff: key.signoff, authorship: key.authorship },
  scope: { apItems: invoiceRuns.length, arItems: receivables.length, scenarios: legacy.reports.length,
    apRuntime: 'Production ClaudeAgentRuntime + Dispatcher + role registry + handoff store + in-memory usage ledger; injected scripted QueryFn.',
    arRuntime: 'Real collections permit and reconciler/auditor DomainTools; direct tool-script seam, not dispatcher or voice conversation.',
    extraction: 'Oracle-fed fixture mock; schema and evidence fidelity only. 8 equally weighted fields per AP item; lineItems is one exact-match field; absent optional adjustment matches absent.',
    providers: 'Synthetic GX10, bank, CRS public-records and Apify responses. No network calls, keys, real calls or money. Positive runtime cost entries are synthetic accounting tests, not spend.',
    fraudDefinition: 'Only key steps with LOOKALIKE_DOMAIN; one planted fraud item. Sanctions and routine bank-change holds are not relabeled fraud.',
    payablesDefinition: 'Keyed invoice initial pay/hold decisions and P08 evidence gate; includes P03 sender variants. P04 passkey application, P10 badge attack, P11 recovery and P12 failover are legacy checks/gaps.',
    falseHoldDefinition: 'Keyed ALLOW invoice steps held / all keyed ALLOW invoice steps. Historical paid invoices excluded from this denominator.',
    unscored: 'The 83 raw AP runs and 10 AR runs are coverage, not 93 labeled ground-truth decisions. Only explicit answer-key labels count toward accuracy.' },
  coverage: { apRuntimeErrors: invoiceRuns.filter(row => row.actual === 'ERROR').map(row => row.id),
    historicalItems: invoiceRuns.filter(row => row.historical).length,
    historicalMockDebits: invoiceRuns.filter(row => row.historical).reduce((sum, row) => sum + row.mockDebits, 0) },
  rates, ap: invoiceRuns, gradedAP, permits, receivables,
  legacy: { signoff: legacy.signoff, reports: legacy.reports }, gaps,
};
const display = (rate: { numerator: number; denominator: number; percent: number | null }) =>
  `${rate.numerator}/${rate.denominator} (${rate.percent === null ? 'N/A' : `${rate.percent}%`})`;
const lines = [
  '# Offline agent eval scoreboard', '',
  '**Synthetic deterministic mock run. These are code-path results, not live model accuracy or production fraud-detection estimates.**', '',
  `Reproduce from the repo root after \`pnpm install --frozen-lockfile\`:`, '', '```sh', command, '```', '',
  `Base commit: \`${report.provenance.baseCommit}\`. Answer key: ${key.version}; signoff: **${key.signoff.status}**.`,
  `Frozen manifest verified: ${Object.keys(manifest.sha256).length} files.`,
  'Input SHA-256 hashes and item-level observations are in [scoreboard.json](scoreboard.json).', '',
  '| Measurement | Result |', '| --- | --- |',
  `| Extraction field fidelity, fixture-fed mock (8 fields × 83 invoices) | ${display(rates.extractionMockFieldFidelity)} |`,
  '| Source/PDF extraction accuracy | Not measured |',
  `| Initial AP pay/hold decisions vs key | ${display(rates.decisions)} |`,
  `| Vendor fraud catch (lookalike sender only) | ${display(rates.fraudCatch)} |`,
  `| Duplicate catch | ${display(rates.duplicateCatch)} |`,
  `| All keyed AP holds caught | ${display(rates.holdCatch)} |`,
  `| False holds on keyed clean ALLOW steps | ${display(rates.falseHolds)} |`,
  `| Authoritative AP decision rule agreement | ${display(rates.exactAPRules)} |`,
  `| Collections pre-call permit agreement | ${display(rates.collectionsPermits)} |`,
  `| Keyed bank-feed reconciliation agreement | ${display(rates.reconciliation)} |`,
  `| Existing eval answer-key checks (partial execution permitted) | ${display(rates.legacyKeyChecks)} |`,
  `| Existing eval scenarios with no unexecuted integration step | ${display(rates.legacyCompleteScenarios)} |`, '',
  '## Coverage and limits', '',
  ...Object.entries(report.scope).map(([name, value]) => `- **${name}**: ${value}`), '',
  '- Every AP invoice runs from a fresh repository snapshot, including historical invoices. Every AR invoice gets a reconciliation trial; every scenario is visited by the existing eval and every collections scenario gets a permit probe.',
  '- Only the initial hold is measured for legitimate bank changes. That hold is required and is not counted as a false hold. No role was tuned to the key.',
  '- The frozen key has 34 team-authored scenarios and zero external scenarios. Small planted-trap denominators cannot support a general fraud-detection claim.', '',
  '## Disagreements and unexecuted evidence', '',
  ...(gaps.length ? gaps.map(row => `- **${row.id}**: ${row.detail}`) : ['No disagreements in the measured seams.']), '',
  '## Keyed AP items', '', '| Item | Invoice | Expected | Actual | Exact rule match |', '| --- | --- | --- | --- | --- |',
  ...gradedAP.map(row => `| ${row.id} | ${row.invoiceId} | ${row.expected} | ${row.actual} | ${row.exactRuleMatch ?? 'workflow gate'} |`), '',
];
const out = join(root, 'docs/eval');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'scoreboard.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(out, 'scoreboard.md'), lines.join('\n'));
console.log(JSON.stringify({ rates, gaps: gaps.length, output: 'docs/eval/scoreboard.{md,json}' }, null, 2));
// Key disagreements are data to report, not a reason to suppress the generated artifact.
if (rates.errors.length || invoiceRuns.some(row => row.actual === 'ERROR')) process.exitCode = 1;
