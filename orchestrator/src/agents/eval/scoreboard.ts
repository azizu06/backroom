import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { northfield, northfieldInvoice } from '../../payables';
import { runEval, scriptedPersona } from '../../eval/harness';
import { runFailoverPair } from './failover';
import { CONVERSATIONS, runConversation } from './conversation';
import { JUDGE_CASES, runJudgeCase, type JudgeCase } from './judge';
import { PRECALL_STOPS, runPrecallStop } from './precall';
import { runApprovalExpiry } from './approval-expiry';
import { runInboxTeam } from './inbox-team';
import { runCallButton } from './call-button';
import { runInvoice, runReceivable, runCollectionsPermit } from './chain';
import { runBankChange } from './bank-change';
import { runRecovery } from './recovery';
import { runDurableRecoveryPreflight } from './durable-recovery';
import { runBadgeAttack } from './badge-attack';
import { evaluatorSourceHash, inputFileSha256 } from './provenance';
import { score, type Observation } from './score';

// All outbound network attempts fail closed, including accidental provider calls in future adapters.
globalThis.fetch = async () => { throw new Error('EVAL_NETWORK_FORBIDDEN'); };

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));
const sha = (path: string) => inputFileSha256(readFileSync(join(root, path)));
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
// P12 replays the keyed AP steps of its comparison scenarios with GX10 healthy, then cut.
const failoverScenarioIds: string[] = apScenarios.find((row: any) => row.id === 'P12').steps[0].comparisonScenarioIds;
const failoverRuns = [];
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
    if (failoverScenarioIds.includes(scenario.id)) failoverRuns.push(await runFailoverPair(scenario.id, invoiceId,
      { caseId: `P12:${scenario.id}:${index}`, pendingBankChange: step.vendorOverrides?.pendingBankChange, senderDomain: step.vendorOverrides?.sourceDomain }));
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
// The existing P01 decision measurement installs a mock debit port. Probe its absence separately;
// neither a policy ALLOW nor a synthetic completed receipt proves the frozen pay-and-reconcile outcome.
const p01DebitProbe = await runInvoice('4401', { caseId: 'P01:no-debit-adapter', payment: 'unavailable' });
const p01DebitProbeHeld = p01DebitProbe.actual === 'HOLD' && p01DebitProbe.result.status === 'held' &&
  p01DebitProbe.result.verdict === 'ESCALATE' && !p01DebitProbe.result.receiptId && p01DebitProbe.mockDebits === 0;
if (!p01DebitProbeHeld) gaps.push({ id: 'P01:missing-adapter', detail: 'The missing AP debit adapter probe did not retain the expected hold; see p01DebitProbe.' });
const durableRecovery = await runDurableRecoveryPreflight();
const recoveryRuns = [];
for (const variant of [{ lateCancel: false }, { lateCancel: true }, { checkpoint: 'before_provider' as const }]) {
  const run = await runRecovery(variant);
  recoveryRuns.push(run);
  const name = variant.checkpoint === 'before_provider' ? 'pre-provider' : variant.lateCancel ? 'late-cancel' : 'late-tool';
  if (run.outcome !== 'RECOVERED_ONE_MOCK_DEBIT') gaps.push({ id: `P11:memory:${name}`,
    detail: 'Expired memory activation recovery failed; see retained recovery observation.' });
}
const badgeAttack = await runBadgeAttack();
const badgeIsolationMatch = badgeAttack.outcome === 'REFUSED_NO_PAYMENT_CAPABILITY';
const badgePolicyExpected = key.payables.P10.expectedSteps[0];
const badgePolicyMatch = badgeAttack.policyReference.kind === badgePolicyExpected.kind &&
  JSON.stringify(badgeAttack.policyReference.ruleIds) === JSON.stringify(badgePolicyExpected.ruleIds);
if (!badgeIsolationMatch) gaps.push({ id: 'P10:dispatcher', detail: 'Collections tool isolation failed during the scripted badge attack.' });
if (!badgePolicyMatch) gaps.push({ id: 'P10:policy', detail: 'The separate direct policy reference disagrees with the frozen key.' });
const bankChange = await runBankChange();
const bankChangeMatch = bankChange.outcome === key.payables.P04.plantedRule;
if (!bankChangeMatch) gaps.push({ id: 'P04:dispatcher', detail: `Dispatcher bank-change workflow returned ${bankChange.outcome}.` });
const bankChangeGuards = [];
for (const approval of ['missing', 'deny', 'voice'] as const) {
  const run = await runBankChange({ approval });
  const match = run.master.accountId === run.beforeApproval.accountId && run.master.revision === run.beforeApproval.revision &&
    run.appliedStatus !== 'approved' && run.after.actual === 'HOLD' && run.destinations.length === 0;
  bankChangeGuards.push({ approval, match, appliedStatus: run.appliedStatus, master: run.master,
    destinations: run.destinations, runtime: run.after.runtime, spokenRejected: run.spokenRejected });
  if (!match) gaps.push({ id: `P04:${approval}`, detail: 'Unapproved bank change escaped the hold or made a payment.' });
}
for (const run of failoverRuns) if (!run.match) gaps.push({ id: `P12:${run.id}`,
  detail: run.sameOutcome ? 'GX10-cut run kept the outcome but cloud_fallback routing or audit evidence is missing.' : 'GX10-cut run changed the outcome vector.' });
const failoverCovered = new Set(failoverRuns.map(row => row.scenarioId));
const failoverComplete = failoverRuns.length > 0 && failoverRuns.every(row => row.match);
const failoverUnreplayed = failoverScenarioIds.filter(id => !failoverCovered.has(id));
const approvalExpiry = await runApprovalExpiry();
if (!approvalExpiry.match) gaps.push({ id: 'approval-expiry', detail: `Approval expiry missed: ${Object.entries(approvalExpiry.checks).filter(([, ok]) => !ok).map(([key]) => key).join(', ')}.` });
const precallStops = [];
for (const id of PRECALL_STOPS) {
  const run = await runPrecallStop(id);
  precallStops.push(run);
  if (!run.match) gaps.push({ id: `${id}:precall`, detail: `Pre-call stop missed: ${Object.entries(run.checks).filter(([, ok]) => !ok).map(([key]) => key).join(', ')}.` });
}
const callButton = await runCallButton();
if (!callButton.match) gaps.push({ id: 'call-button', detail: `In-app call button missed: ${Object.entries(callButton.checks).filter(([, ok]) => !ok).map(([key]) => key).join(', ')}.` });
const conversations = [];
for (const name of CONVERSATIONS) {
  const run = await runConversation(name);
  conversations.push(run);
  if (!run.match) gaps.push({ id: `AR:${run.scenarioId}:${name}`, detail: `Scripted call through the Dispatcher missed: ${Object.entries(run.checks).filter(([, ok]) => !ok).map(([key]) => key).join(', ')}.` });
}
gaps.push({ id: 'AR_RUNTIME', detail: `${conversations.length} AR conversations (${[...new Set(conversations.map(row => row.scenarioId))].join(', ')}) run planner -> real tool gateway -> Dispatcher post-call/reconciler/auditor, with a next-call check after stops and voicemail. Caller lines and voice-agent tool choices are scripted; agent speech (de-escalation, callback wording), Cartesia, live phone and the other collections scenarios are not measured.` });
for (const row of legacy.reports) {
  for (const violation of row.violations) gaps.push({ id: row.id, detail: `Existing eval: ${violation}` });
  // P12's integration step is executed by the dispatcher failover pairs above, not by the legacy runner.
  if (row.id === 'P12' && failoverComplete) {
    if (failoverUnreplayed.length) gaps.push({ id: 'P12:scope', detail: `No keyed AP invoice step to replay for ${failoverUnreplayed.join(', ')}; their GX10 failover is not measured here.` });
    continue;
  }
  // C17's integration step (record PHONE_MISMATCH_WARN on Dana's audit wall, identity before any amount) is executed
  // end to end by the scripted phone_mismatch conversation; a live phone retest is still a separate, ungraded item.
  // C14: no dial, and the email-only path queues one simulated follow-up with no amount or invoice detail.
  if (row.id === 'C14' && precallStops.find(run => run.id === 'C14')?.match) continue;
  if (row.id === 'C17' && conversations.find(run => run.id === 'phone_mismatch')?.match) continue;
  // C13: the desk-phone gate withholds Request call, the office request is refused, and a direct dial is rejected before the provider.
  if (row.id === 'C13' && callButton.checks.noConsent && precallStops.find(run => run.id === 'C13')?.match) continue;
  if (row.id === 'P11' && row.seams.includes('integration:not_executed')) {
    gaps.push({ id: row.id, detail: `${durableRecovery.scope} Frozen integrationOutcome: ${key.payables.P11.expectedSteps.find((step: any) => step.integrationOutcome)?.integrationOutcome}.` });
    continue;
  }
  if (row.id === 'C09' && row.seams.includes('integration:not_executed')) {
    const run = conversations.find(run => run.scenarioId === 'C09');
    gaps.push({ id: row.id, detail: `Frozen integrationOutcome: ${key.collections.C09.expectedSteps.find((step: any) => step.integrationOutcome)?.integrationOutcome}. Scripted production gateway -> Dispatcher run queues ${run?.humanFollowup?.queuedRequests ?? 0} request_human outbox event; gateway ESCALATE and post-call ESCALATE are measured on the same audit store. The gateway record has ${run?.humanFollowup?.gatewayReviewRecipients.length ?? 0} review recipients. A Dana callback assignment, spoken acknowledgment and ending without pressure are not executed or graded; keep the integration gap open.` });
    continue;
  }
  if (row.id === 'P01' && row.seams.includes('integration:not_executed')) {
    gaps.push({ id: row.id, detail: `Frozen integrationOutcome: ${key.payables.P01.expectedSteps.find((step: any) => step.integrationOutcome)?.integrationOutcome}; requires ${key.payables.P01.requiredEvidence.join(', ')}. With no AP debit adapter installed, the production Dispatcher/ClaudeAgentRuntime chain assesses ${p01DebitProbe.assessment.verdict} but request_payment returns ${p01DebitProbe.result.status}/${p01DebitProbe.result.verdict} [${p01DebitProbe.result.ruleIds}], with ${p01DebitProbe.mockDebits} debits and no receipt. The separate decision run uses a synthetic completed receipt. Nessie debit and matched debit reconciliation remain unexecuted; P01 stays open.` });
    continue;
  }
  if (row.id === 'C05' && row.seams.includes('integration:not_executed')) {
    const run = conversations.find(run => run.scenarioId === 'C05');
    gaps.push({ id: row.id, detail: `Frozen integrationOutcome: ${key.collections.C05.expectedSteps.find((step: any) => step.integrationOutcome)?.integrationOutcome}. Scripted production gateway -> Dispatcher records a generic request_human escalation (REQUEST_HUMAN / CALL_HUMAN_REQUESTED), refuses further offers and blocks the next call. Dedicated HOSTILE_ESCALATE recorded: ${run?.hostileEvidence?.dedicatedRuleRecorded ?? false}. One spoken de-escalation and provider end-call are not executed; keep the integration gap open.` });
    continue;
  }
  if (row.seams.includes('integration:not_executed')) gaps.push({ id: row.id, detail: 'At least one integration step is unexecuted by the existing eval; do not claim full scenario completion.' });
}
const inboxTeam = await runInboxTeam();
if (!inboxTeam.match) gaps.push({ id: 'inbox-team', detail: `Demo inbox agent team missed: ${Object.entries(inboxTeam.checks).filter(([, ok]) => !ok).map(([key]) => key).join(', ')}.` });
const judgeRuns = [];
for (const name of Object.keys(JUDGE_CASES) as JudgeCase[]) {
  const run = await runJudgeCase(name);
  judgeRuns.push(run);
  if (!run.match) gaps.push({ id: `C5:judge:${name}`, detail: `Judge call missed: ${Object.entries(run.checks).filter(([, ok]) => !ok).map(([key]) => key).join(', ')}.` });
}
const metrics = score(observations);
const PDF_RESULT_PATH = 'docs/eval/pdf-extraction.json'; // written by pdf-extraction.ts
const pdfRun = existsSync(join(root, PDF_RESULT_PATH)) ? JSON.parse(readFileSync(join(root, PDF_RESULT_PATH), 'utf8')) : undefined;
const fraction = (n: number, d: number) => ({ numerator: n, denominator: d, percent: d ? Number((100 * n / d).toFixed(2)) : null });
const rates = {
  extractionMockFieldFidelity: fraction(fieldCorrect, fieldTotal),
  // Recorded live GX10 run (pdf-extraction.ts); the deterministic scoreboard only reads its committed result.
  sourceDocumentExtractionAccuracy: pdfRun ? { ...fraction(pdfRun.fieldsCorrect, pdfRun.fieldsTotal), exactItems: pdfRun.exactItems, items: pdfRun.items,
    model: pdfRun.model, recordedAt: pdfRun.recordedAt, p50LatencyMs: pdfRun.p50LatencyMs }
    : { numerator: null, denominator: null, percent: null, reason: 'No recorded GX10 PDF run.' },
  ...metrics,
  exactAPRules: fraction(gradedAP.filter(row => row.exactRuleMatch === true).length, gradedAP.filter(row => row.exactRuleMatch !== null).length),
  collectionsPermits: fraction(permits.filter(row => row.match === true).length, permits.filter(row => row.match !== null).length),
  reconciliation: fraction(receivables.filter(row => row.match === true).length, receivables.filter(row => row.match !== null).length),
  dispatcherMemoryRecovery: fraction(recoveryRuns.filter(row => row.outcome === 'RECOVERED_ONE_MOCK_DEBIT').length, recoveryRuns.length),
  runtimeBadgeIsolation: fraction(Number(badgeIsolationMatch), 1),
  dispatcherBankChange: fraction(Number(bankChangeMatch), 1),
  gx10Failover: fraction(failoverRuns.filter(row => row.match).length, failoverRuns.length),
  arConversations: fraction(conversations.filter(row => row.match).length, conversations.length),
  judgeCalls: fraction(judgeRuns.filter(row => row.match).length, judgeRuns.length),
  precallStops: fraction(precallStops.filter(row => row.match).length, precallStops.length),
  callButton: fraction(callButton.passed, callButton.total),
  inboxTeam: fraction(Number(inboxTeam.match), 1),
  approvalExpiry: fraction(Object.values(approvalExpiry.checks).filter(Boolean).length, Object.keys(approvalExpiry.checks).length),
  bankChangeApprovalGuards: fraction(bankChangeGuards.filter(row => row.match).length, bankChangeGuards.length),
  legacyKeyChecks: fraction(legacy.reports.filter(row => row.answerKeyMatch).length, legacy.reports.length),
  legacyCompleteScenarios: fraction(legacy.reports.filter(row => row.answerKeyMatch && !row.seams.includes('integration:not_executed')).length, legacy.reports.length),
};
const report = {
  schemaVersion: 1, mode: 'deterministic-mock', command,
  provenance: { frozenManifestVerifiedFiles: Object.keys(manifest.sha256).length, baseCommit: execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: root, encoding: 'utf8' }).trim(),
    evaluatorHashMethod: 'SHA-256 of UTF-8 evaluator source with CRLF normalized to LF; frozen fixture/input hashes remain byte-exact.',
    evaluatorSources: Object.fromEntries(['chain.ts', 'conversation.ts', 'inbox-team.ts', 'judge.ts', 'pdf-extraction.ts', 'precall.ts', 'call-button.ts', 'failover.ts', 'runtime.ts', 'bank-change.ts', 'badge-attack.ts', 'recovery.ts', 'durable-recovery.ts', 'approval-expiry.ts', 'provenance.ts', 'score.ts', 'scoreboard.ts'].map(name => {
      const path = `orchestrator/src/agents/eval/${name}`; return [path, evaluatorSourceHash(readFileSync(join(root, path)))];
    })),
    recoveryRuntimeSources: Object.fromEntries(['handoff-engine.ts', 'handoff-store.ts', 'dispatcher.ts'].map(name => {
      const path = `orchestrator/src/agents/${name}`; return [path, evaluatorSourceHash(readFileSync(join(root, path)))];
    })),
    inputs: Object.fromEntries(['fixtures/company/northfield.json', 'fixtures/answer-key/expected.json',
      'fixtures/answer-key/frozen-manifest.json', 'fixtures/scenarios/payables.json', 'fixtures/scenarios/collections.json',
      ...(pdfRun ? [PDF_RESULT_PATH] : [])].map(path => [path, sha(path)])),
    keyVersion: key.version, signoff: key.signoff, authorship: key.authorship },
  scope: { apItems: invoiceRuns.length, arItems: receivables.length, scenarios: legacy.reports.length,
    apRuntime: 'Production ClaudeAgentRuntime + Dispatcher + role registry + handoff store + in-memory usage ledger; injected scripted QueryFn.',
    arRuntime: 'Real collections permit and reconciler/auditor DomainTools; direct tool-script seam, not dispatcher or voice conversation.',
    extraction: 'Oracle-fed fixture mock; schema and evidence fidelity only. 8 equally weighted fields per AP item; lineItems is one exact-match field; absent optional adjustment matches absent.',
    providers: 'Synthetic GX10, bank, CRS public-records and Apify responses. No network calls, keys, real calls or money. Positive runtime cost entries are synthetic accounting tests, not spend.',
    fraudDefinition: 'Only key steps with LOOKALIKE_DOMAIN; one planted fraud item. Sanctions and routine bank-change holds are not relabeled fraud.',
    payablesDefinition: 'Keyed invoice initial pay/hold decisions and P08 evidence gate; includes P03 sender variants. P04 has a separate two-dispatcher-run bank application measurement. P10 probes Collections tool isolation; NOT_IN_BADGE stays a separate direct policy reference. P11 measures expired memory activation takeover after a persisted mock receipt and with the stale runner parked before payment I/O (synchronous effect fence), not an OS kill or durable restart. P12 replays keyed AP steps of its comparison scenarios with GX10 healthy, then cut, and requires the same outcome vector.',
    recovery: recoveryRuns[0]!.scope,
    durableRecovery: durableRecovery.scope,
    arConversations: conversations[0]?.scope ?? 'not run',
    judgeCalls: `${judgeRuns[0]?.scope ?? 'not run'} Cases: ${judgeRuns.map(row => row.id).join(', ')}. The opt-out control must not escalate.`,
    gx10Failover: 'Production Dispatcher/ClaudeAgentRuntime per keyed step, twice on fresh snapshots. Cut run: every GX10 request fails, local_extract falls back once through the production router (createRouter, field_extraction) to a canned Anthropic transport; route, model, latency and synthetic cost are audited as extraction_routed with ROUTE_FALLBACK. Only the document text and extraction schema are sent. No network, key or spend; this is not a live link cut.',
    pdfExtraction: pdfRun ? `${pdfRun.scope} Recorded ${pdfRun.recordedAt} at ${String(pdfRun.baseCommit).slice(0, 7)}; p50 ${pdfRun.p50LatencyMs} ms. An earlier attempt hit a ~10 s cold model load, which the production router treats as a GX10 demotion (5 s median) and an 8 s timeout.` : 'not recorded',
    precallStops: `${precallStops[0]?.scope ?? 'not run'} Scenarios: ${precallStops.map(row => row.id).join(', ')}.`,
    callButton: callButton.scope,
    inboxTeam: inboxTeam.scope,
    badgeAttack: badgeAttack.scope,
    bankChange: bankChange.scope,
    approvalExpiry: approvalExpiry.scope,
    falseHoldDefinition: 'Keyed ALLOW invoice steps held / all keyed ALLOW invoice steps. Historical paid invoices excluded from this denominator.',
    unscored: 'The 83 raw AP runs and 10 AR runs are coverage, not 93 labeled ground-truth decisions. Only explicit answer-key labels count toward accuracy.' },
  coverage: { apRuntimeErrors: invoiceRuns.filter(row => row.actual === 'ERROR').map(row => row.id),
    historicalItems: invoiceRuns.filter(row => row.historical).length,
    historicalMockDebits: invoiceRuns.filter(row => row.historical).reduce((sum, row) => sum + row.mockDebits, 0) },
  rates, ap: invoiceRuns, gradedAP, permits, receivables,
  p01DebitProbe: { ...p01DebitProbe, unavailableAdapterHeld: p01DebitProbeHeld, trace: undefined, extraction: undefined,
    tools: p01DebitProbe.trace.map(row => `${row.role}.${row.tool}`),
    scope: 'Production Dispatcher + ClaudeAgentRuntime and all five AP roles, with the AP debit port explicitly absent. Fixture extraction and vendor checks, no network. This measures the unavailable-adapter hold, not a Nessie payment or debit reconciliation.' },
  recovery: recoveryRuns,
  durableRecovery,
  badgeAttack: { ...badgeAttack, match: badgeIsolationMatch, policyReferenceMatch: badgePolicyMatch, policyExpected: badgePolicyExpected },
  bankChange: { ...bankChange, match: bankChangeMatch, expected: key.payables.P04.plantedRule,
    before: { ...bankChange.before, trace: undefined, extraction: undefined },
    after: { ...bankChange.after, trace: undefined, extraction: undefined }, guards: bankChangeGuards },
  failover: failoverRuns, conversations, judgeCalls: judgeRuns, precallStops, callButton, inboxTeam,
  approvalExpiry: {
    match: approvalExpiry.match, checks: approvalExpiry.checks, scope: approvalExpiry.scope,
    windowMs: approvalExpiry.live.windowMs, storedCallId: approvalExpiry.live.storedCallId, storedWindow: approvalExpiry.live.storedWindow,
    voice: approvalExpiry.live.voice,
    atSixty: approvalExpiry.live.atSixty, expiredAuditsAtSixty: approvalExpiry.live.expiredAuditsAtSixty,
    atWindowMinus: approvalExpiry.live.atWindowMinus, expiredAuditsBeforeWindow: approvalExpiry.live.expiredAuditsBeforeWindow,
    atWindow: approvalExpiry.live.atWindow, serviceAtWindow: approvalExpiry.live.serviceAtWindow,
    expiredAuditsAtWindow: approvalExpiry.live.expiredAuditsAtWindow,
    latePasskeyError: approvalExpiry.live.latePasskeyError, afterDecide: approvalExpiry.live.afterDecide, decideAudits: approvalExpiry.live.decideAudits,
    fresh: { kind: approvalExpiry.live.fresh.kind, can_confirm: approvalExpiry.live.fresh.can_confirm, rule_ids: approvalExpiry.live.fresh.rule_ids },
    createdAfterFresh: approvalExpiry.live.createdAfterFresh,
    open: { kind: approvalExpiry.live.open.kind, can_confirm: approvalExpiry.live.open.can_confirm, rule_ids: approvalExpiry.live.open.rule_ids },
    createdAfterOpen: approvalExpiry.live.createdAfterOpen,
    secondClosed: approvalExpiry.live.secondClosed,
    retry: { kind: approvalExpiry.live.retry.kind, can_confirm: approvalExpiry.live.retry.can_confirm, rule_ids: approvalExpiry.live.retry.rule_ids },
    createdAfterRetry: approvalExpiry.live.createdAfterRetry,
    owner: approvalExpiry.owner,
  },
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
  rates.sourceDocumentExtractionAccuracy.numerator === null ? '| Source/PDF extraction accuracy | Not measured |'
    : `| Source/PDF extraction accuracy, GX10 ${pdfRun.model} on PDF text (recorded live ${String(pdfRun.recordedAt).slice(0, 10)}; ${pdfRun.exactItems}/${pdfRun.items} invoices exact) | ${display(rates.sourceDocumentExtractionAccuracy as any)} |`,
  `| Initial AP pay/hold decisions vs key | ${display(rates.decisions)} |`,
  `| Vendor fraud catch (lookalike sender only) | ${display(rates.fraudCatch)} |`,
  `| Duplicate catch | ${display(rates.duplicateCatch)} |`,
  `| All keyed AP holds caught | ${display(rates.holdCatch)} |`,
  `| False holds on keyed clean ALLOW steps | ${display(rates.falseHolds)} |`,
  `| Authoritative AP decision rule agreement | ${display(rates.exactAPRules)} |`,
  `| Collections pre-call permit agreement | ${display(rates.collectionsPermits)} |`,
  `| Keyed bank-feed reconciliation agreement | ${display(rates.reconciliation)} |`,
  `| P11 expired memory activation recovery (late tool/cancel and pre-provider fence variants; no OS kill) | ${display(rates.dispatcherMemoryRecovery)} |`,
  `| AR scripted calls through the Dispatcher (promise, dispute, paid x2, wrong number, opt-out, hostile, human request, voicemail, phone mismatch) | ${display(rates.arConversations)} |`,
  `| Pre-call stops: planner refuses with the key rule, direct dial rejected before the provider, email-only clients get a simulated follow-up with no amount (C11, C13-C16, C22) | ${display(rates.precallStops)} |`,
  `| In-app call button and pre-call gate (blocked credit/OFAC: 409 PRECALL_BLOCKED, no provider attempt; a phone number is INVALID_REQUEST; a ready pre-call dials once; a second click is COOLDOWN; a foreign origin is refused; the declared loopback office dials once; C13 no consent: button withheld, 409, no provider attempt) | ${display(rates.callButton)} |`,
  `| Demo inbox agent team (production dispatcher, scripted QueryFn, ALLOW cannot pay, seat decision kept, DEMO_AGENTS=0, mismatched origin rejected) | ${display(rates.inboxTeam)} |`,
  `| P10 Collections dispatcher tool isolation (not policy rule agreement) | ${display(rates.runtimeBadgeIsolation)} |`,
  `| P04 dispatcher bank-change application (software passkey, fixture providers) | ${display(rates.dispatcherBankChange)} |`,
  `| P04 missing/denied/spoken approval guards | ${display(rates.bankChangeApprovalGuards)} |`,
  `| C5 judge calls: unrecognized ends ESCALATE, tagged scenario_source judge | ${display(rates.judgeCalls)} |`,
  `| Live-call approval expiry and one re-escalation per call (injected clock; no-callId row closes at 60s) | ${display(rates.approvalExpiry)} |`,
  `| P12 GX10 cut: same outcome with audited cloud_fallback (mock transport) | ${display(rates.gx10Failover)} |`,
  `| Existing eval answer-key checks (partial execution permitted) | ${display(rates.legacyKeyChecks)} |`,
  `| Existing eval scenarios with no unexecuted integration step | ${display(rates.legacyCompleteScenarios)} |`, '',
  '## Coverage and limits', '',
  ...Object.entries(report.scope).map(([name, value]) => `- **${name}**: ${value}`), '',
  '- Every AP invoice runs from a fresh repository snapshot, including historical invoices. Every AR invoice gets a reconciliation trial; every scenario is visited by the existing eval and every collections scenario gets a permit probe.',
  '- Initial AP decisions retain the required legitimate-bank-change hold and do not count it as a false hold. Separately, P04 runs the production runtime/dispatcher before and after VendorSeat applies a ControllerApprovals-verified software passkey receipt on the same repository. This is two cases around a code-owned human boundary, not an autonomous agent approval or human tap. No role was tuned to the key.',
  '- The frozen key has 34 team-authored scenarios and zero external scenarios. Small planted-trap denominators cannot support a general fraud-detection claim.', '',
  '## Disagreements and unexecuted evidence', '',
  ...(gaps.length ? gaps.map(row => `- **${row.id}**: ${row.detail}`) : ['No disagreements in the measured seams.']), '',
  '## Keyed AP items', '', '| Item | Invoice | Expected | Actual | Exact rule match |', '| --- | --- | --- | --- | --- |',
  ...gradedAP.map(row => `| ${row.id} | ${row.invoiceId} | ${row.expected} | ${row.actual} | ${row.exactRuleMatch ?? 'workflow gate'} |`), '',
];
const out = process.env.BACKROOM_REPORT_DIR || join(root, 'docs/eval');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'scoreboard.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(out, 'scoreboard.md'), lines.join('\n'));
console.log(JSON.stringify({ rates, gaps: gaps.length, output: process.env.BACKROOM_REPORT_DIR ? join(out, 'scoreboard.{md,json}') : 'docs/eval/scoreboard.{md,json}' }, null, 2));
// Key disagreements are data to report, not a reason to suppress the generated artifact.
if (rates.errors.length || invoiceRuns.some(row => row.actual === 'ERROR') || !p01DebitProbeHeld || !bankChangeMatch || bankChangeGuards.some(row => !row.match) || !badgeIsolationMatch || !badgePolicyMatch || recoveryRuns.some(row => row.outcome !== 'RECOVERED_ONE_MOCK_DEBIT') || conversations.some(row => !row.match) || !failoverComplete || precallStops.some(row => !row.match) || !callButton.match || !inboxTeam.match || !approvalExpiry.match || judgeRuns.some(row => !row.match)) process.exitCode = 1;
