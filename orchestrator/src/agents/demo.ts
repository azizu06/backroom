import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { MemoryStateStore } from '../store';
import type { DomainTool, Json, Role, Specialist } from './contracts';
import { Dispatcher, type CaseRequest } from './dispatcher';
import { MemoryHandoffStore } from './handoff-store';
import { scriptedQuery, type ScriptStep } from './mock-query';
import { specialists as registered } from './roles';
import { ClaudeAgentRuntime } from './runtime';
import { FileUsageLedger, MemoryUsageLedger } from './usage';

/** `pnpm --filter @backroom/orchestrator demo:agents [--live]`
 * Synthetic stand-in specialists exercise the shared runtime, handoff seal, dispatcher,
 * ledger and office projection end to end. Registered role workers replace a stub when
 * they add themselves to roles/index.ts. Mocked by default: no network, no key, $0.
 * `--live` runs the AP chain once on claude-haiku-5-5 with the Keychain key
 * (`backroom-anthropic-key`), read into the child env only. Expect well under $0.01. */
const live = process.argv.includes('--live');

const stub = <I>(name: string, description: string, input: z.ZodType<I>, execute: (input: I, caseId: string) => Json): DomainTool<I, Json> =>
  ({ name, description, input, async execute(ctx, value) { await ctx.assertCurrent(); return execute(value, ctx.activation.caseId); } });
const none = z.object({});
const spec = (role: Role, allowedNext: Role[], prompt: string, tools: DomainTool<any, Json>[]): Specialist =>
  ({ role, model: 'claude-haiku-5-5', allowedNext, prompt, tools });

let vendorChecks = 0;
const stubs: Record<Role, Specialist> = {
  intake: spec('intake', ['extractor'], 'Classify the inbox item with read_inbox_item. Invoices go to extractor.', [
    stub('read_inbox_item', 'Read safe metadata for this case\'s inbox item', none, (_, id) => ({ kind: 'invoice', from: 'billing@northfield-supply.example', artifactRef: `${id}:inbox` })),
  ]),
  extractor: spec('extractor', ['vendor', 'payables', 'intake'], 'Extract invoice facts with read_document. Unverified vendors go to vendor; verified ones to payables.', [
    stub('read_document', 'Read and validate the invoice document fields', none, (_, id) => ({ invoiceId: 'INV-4419', vendorId: 'northfield-supply', amountCents: 425000,
      remitDomain: vendorChecks ? 'northfield-supply.example' : null, vendorVerified: false, artifactRef: `${id}:extraction${vendorChecks ? '-v2' : ''}` })),
  ]),
  vendor: spec('vendor', ['payables', 'extractor'], 'Verify the vendor with check_vendor. If the remit domain is missing, return to extractor; otherwise pass the evidence to payables.', [
    stub('check_vendor', 'Check the approved vendor master, domain and pending bank changes', none, (_, id): Json => ++vendorChecks === 1
      ? { verified: false, missing: 'remitDomain', artifactRef: `${id}:vendor-check-1` }
      : { verified: true, pendingBankChange: true, domainMatch: false, artifactRef: `${id}:vendor-check-2` }),
  ]),
  payables: spec('payables', ['auditor', 'extractor', 'vendor'], 'Decide readiness with evaluate_invoice. A hold is final for payment; hand the evidence to auditor.', [
    stub('evaluate_invoice', 'Code policy evaluation of this invoice; returns ALLOW, DENY or ESCALATE', z.object({ invoiceId: z.string() }), (_, id) =>
      ({ decision: 'ESCALATE', ruleIds: ['BANK_CHANGE_HOLD'], paymentExecuted: false, note: 'Controller passkey required', artifactRef: `${id}:decision` })),
  ]),
  collections: spec('collections', ['reconciler'], 'Review the collection call outcome with read_call, then pass payment evidence to reconciler.', [
    stub('read_call', 'Read the completed collection call outcome', none, (_, id) => ({ outcome: 'already_paid_claim', artifactRef: `${id}:call` })),
  ]),
  reconciler: spec('reconciler', ['auditor', 'collections'], 'Check the claim with match_payment. Pass matches to auditor.', [
    stub('match_payment', 'Code-owned exact match against the bank feed', none, (_, id) => ({ matched: true, artifactRef: `${id}:match` })),
  ]),
  auditor: spec('auditor', ['intake', 'extractor', 'vendor', 'payables', 'collections', 'reconciler'], 'Close out with read_audit and finish when evidence is complete.', [
    stub('read_audit', 'Read this case\'s audit and evidence chain', none, (_, id) => ({ complete: true, artifactRef: `${id}:closeout` })),
  ]),
};
const team: Record<Role, Specialist> = { ...stubs, ...registered };

const handoff = (to: Role, summary: string, refs: (outputs: unknown[]) => string[]): ScriptStep =>
  ({ tool: 'handoff', args: outputs => ({ to, reason: summary, summary, artifactRefs: refs(outputs) }) });
const ref = (outputs: unknown[], i = 0) => (outputs[i] as { artifactRef: string }).artifactRef;
const vendorTurns: ScriptStep[][] = [
  [{ tool: 'check_vendor', args: {} }, handoff('extractor', 'Remit domain is missing from the extraction; please re-read the invoice.', o => [ref(o)])],
  [{ tool: 'check_vendor', args: {} }, handoff('payables', 'Vendor in master, but a bank change is pending and the domain does not match.', o => [ref(o)])],
];
let vendorTurn = 0;
const scripts: Record<string, () => ScriptStep[]> = {
  intake: () => [{ tool: 'read_inbox_item', args: {} }, handoff('extractor', 'Vendor invoice received; please extract it.', o => [ref(o)])],
  extractor: () => [{ tool: 'read_document', args: {} }, handoff('vendor', 'Extracted INV-4419 for $4,250.00; vendor needs verification.', o => [ref(o)])],
  vendor: () => vendorTurns[vendorTurn++] ?? [],
  // The scripted Payables also tries a second tool after sealing; the runtime must refuse it.
  payables: () => [{ tool: 'evaluate_invoice', args: { invoiceId: 'INV-4419' } },
    handoff('auditor', 'Policy held INV-4419 on BANK_CHANGE_HOLD; no payment made. Please close out.', o => [ref(o)]),
    { tool: 'evaluate_invoice', args: { invoiceId: 'INV-4419' } }],
  collections: () => [{ tool: 'read_call', args: {} }, handoff('reconciler', 'Client says invoice was already paid; please match it.', o => [ref(o)])],
  reconciler: () => [{ tool: 'match_payment', args: {} }, handoff('auditor', 'Payment matched exactly in the bank feed.', o => [ref(o)])],
  auditor: () => [{ tool: 'read_audit', args: {} }],
};

async function main() {
  const control = new MemoryStateStore();
  const store = new MemoryHandoffStore({ audit: control });
  store.subscribe(row => console.log(`[office] #${row.sequence} ${row.fromRole} -> ${row.toRole} ${row.status}${row.correction ? ' (correction)' : ''}`
    + `${row.errorCode ? ` ${row.errorCode}` : ''} | ${row.toVoiceRole}: "${row.line}"`));
  const calls: { role: string; tool: string; denied?: string; isError?: boolean }[] = [];
  const runtime = new ClaudeAgentRuntime({
    credential: live ? () => execFileSync('security', ['find-generic-password', '-s', 'backroom-anthropic-key', '-w'], { encoding: 'utf8' }).trim() : () => 'mock-no-network',
    ...(live ? {} : { query: scriptedQuery(role => scripts[role]?.() ?? [], { calls }) }),
    recordArtifacts: (ctx, refs) => store.recordArtifacts(ctx, refs),
  });
  const dispatcher = new Dispatcher({ runtime, store, control, specialists: team, runnerId: 'demo-runner',
    ledger: live ? new FileUsageLedger() : new MemoryUsageLedger(), mode: 'development',
    onEvent: event => { if (event.type === 'activation_started') console.log(`[agent] ${event.role} starts ${event.activationId}`); } });
  const cases: CaseRequest[] = [
    { caseId: 'demo-ap-4419', role: 'intake', artifactRefs: [], credentialOwnerId: 'aziz', input: { inboxItem: 'Invoice email from Northfield Supply (synthetic)' } },
    ...(live ? [] : [{ caseId: 'demo-ar-2207', role: 'collections' as const, artifactRefs: [], credentialOwnerId: 'aziz', input: { callId: 'call-2207 (synthetic)' } }]),
  ];
  let total = 0;
  for (const request of cases) {
    const result = await dispatcher.runCase(request);
    total += result.costUsd;
    console.log(`[case] ${result.caseId} ${result.status}${result.reason ? ` (${result.reason})` : ''}: `
      + `${result.activations.map(a => `${a.role}:${a.kind}`).join(' -> ')} | est $${result.costUsd.toFixed(6)}`);
    if (live) for (const a of result.activations) console.log(`  ${a.role} session=${a.usage?.sessionId} cost=${a.usage?.costUsd} wall=${a.usage?.wallMs}ms init=${a.usage?.initMs}ms`);
  }
  const refused = calls.filter(c => c.denied || c.isError);
  if (!live) console.log(`[runtime] refused after seal or invalid: ${refused.map(c => `${c.role}.${c.tool}`).join(', ') || 'none'}`);
  console.log(`[audit] chain ${(await control.verifyAuditChain()).valid ? 'verified' : 'BROKEN'}, ${(await control.listAudit()).length} entries`);
  console.log(`[spend] ${live ? 'SDK-estimated' : 'mock'} total_cost_usd=${total.toFixed(6)}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'DEMO_FAILED'); process.exitCode = 1; });
