/** Demo inbox agent team (#212): production createInboxAgents narrates an already recorded
 * seat decision. Scripted QueryFn, no provider spend. An ALLOW assessment still cannot pay.
 * DEMO_AGENTS=0 is the production narrateInbox gate and creates no agent case. */
import { createNorthfieldRepository, northfieldInvoice } from '../../payables/northfield';
import { MemoryStateStore } from '../../store';
import { MemoryUsageLedger } from '../usage';
import { scriptedQuery, type ScriptedCall, type ScriptStep } from '../mock-query';
import { createInboxAgents, demoAgentsEnabled, narrateInbox, resetInboxAgents, type InboxNarration } from '../../../../web/lib/demo/agents';
import { createInboxHTTP } from '../../../../web/lib/inbox/http';
import { inboxPresets } from '../../../../web/lib/inbox/presets';

const handoff = (to: string, refs: (outputs: unknown[]) => string[]): ScriptStep => ({ tool: 'handoff',
  args: outputs => ({ to, reason: 'completed', summary: 'Cited narration; no payment or approval.', artifactRefs: refs(outputs) }) });
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const close = (actual: number | undefined, expected: number) => actual !== undefined && Math.abs(actual - expected) < 5e-7;

/** Tool sequence from the production narration test, so the real role modules run. */
function scripts(item: string): (role: string) => ScriptStep[] {
  return role => ({
    intake: [{ tool: 'read_inbox_item', args: { itemRef: item } }, handoff('extractor', () => [item])],
    extractor: [{ tool: 'read_document', args: { documentRef: item, chunk: 0 } },
      { tool: 'local_extract', args: { documentRef: item } },
      { tool: 'validate_extraction', args: (outputs: unknown[]) => ({ documentRef: item, fields: (outputs[1] as { fields: unknown }).fields }) },
      handoff('vendor', outputs => [item, (outputs[2] as { artifactRef: string }).artifactRef])],
    vendor: [{ tool: 'get_vendor_master', args: {} }, { tool: 'check_domain', args: { which: 'sender' } },
      { tool: 'check_domain', args: { which: 'claimed' } }, { tool: 'check_business', args: {} },
      { tool: 'conclude_verification', args: { outcome: 'proceed', note: 'Master, domains and mocked CRS agree.' } },
      handoff('payables', outputs => [(outputs[4] as { verdictRef: string }).verdictRef])],
    payables: [{ tool: 'evaluate_invoice', args: {} }, { tool: 'request_payment', args: {} },
      handoff('auditor', outputs => (outputs[1] as { evidenceRefs: string[] }).evidenceRefs)],
    auditor: [{ tool: 'read_audit', args: {} }, { tool: 'verify_chain', args: {} },
      { tool: 'record_case_summary', args: (outputs: unknown[]) => ({ summary: `Narration only [entry:${(outputs[1] as { auditIds: string[] }).auditIds[0]}]`, citations: [(outputs[1] as { auditIds: string[] }).auditIds[0]] }) }],
  })[role] ?? [];
}

const hostSlot = () => globalThis as typeof globalThis & { backroomInboxAgents?: unknown };

export async function runInboxTeam() {
  const priorFetch = globalThis.fetch;
  let providerRequests = 0;
  globalThis.fetch = async () => {
    providerRequests += 1;
    throw new Error('EVAL_NETWORK_FORBIDDEN');
  };
  try {
    const calls: ScriptedCall[] = [];
    const control = new MemoryStateStore();
    const repository = await createNorthfieldRepository();
    const fields = northfieldInvoice('4401');
    const item: InboxNarration['item'] = { id: 'judge:sample', source: 'judge', kind: 'invoice', senderDomain: 'papertrail.example', text: 'Invoice 4401; untrusted content.' };
    const entry = await control.appendAudit({ actor: 'code', seat: 'payables', action: 'judge_inbox_decision', ts: Date.now(),
      decision: 'ALLOW', ruleIds: [], policyVersion: 1, refs: [item.id], route: 'code', latencyMs: 0, costUsd: 0,
      inputs: { fields, scenario_source: 'judge' } });
    const input: InboxNarration = { item, fields, repository, auditId: entry.id,
      result: { status: 'held', decision: { kind: 'ALLOW', ruleIds: [], policyVersion: 1 }, evidenceRefs: [item.id] } };
    const seatBefore = structuredClone((await control.listAudit()).find(row => row.id === entry.id));
    const host = createInboxAgents({ control, ledger: new MemoryUsageLedger(),
      query: scriptedQuery(scripts(item.id), { calls }), credential: () => 'mock-key',
      vendor: { bankChangeRisk: { async check() { return { score: 8, label: 'CRS sandbox: test identity #1',
        checkedAt: '2026-10-24T12:00:00Z', responseHash: 'a'.repeat(64) }; } },
      publicRecords: async () => ({ bankruptcies: 0, evidenceRef: `crs:sha256:${'b'.repeat(64)}` }) } });
    let result: Awaited<ReturnType<typeof host.submit>> | undefined;
    let again: Awaited<ReturnType<typeof host.submit>> | undefined;
    try {
      result = await host.submit(input);
      again = await host.submit(input);
    } finally { await host.stop(); }
    const publicRows = await host.store.listPublic();
    const audits = await control.listAudit();
    const seatAfter = audits.find(row => row.id === entry.id);
    const narrationHold = audits.find(row => row.action === 'agent_narration_hold');
    const assessment = asRecord(calls.find(row => row.tool === 'evaluate_invoice')?.output);
    const payment = asRecord(calls.find(row => row.tool === 'request_payment')?.output);
    const paymentRules = Array.isArray(payment?.ruleIds) ? payment.ruleIds.map(String) : [];
    const inboxMeta = asRecord(asRecord(calls.find(row => row.tool === 'read_inbox_item')?.output)?.metadata);
    const paid = audits.some(row => row.action === 'nessie_completed' || row.action === 'pay_invoice');
    const spent = (await host.ledger.usage('aziz')).spentUsd;
    const optOut = await runOptOut(input);
    const checks = {
      fiveRoles: result?.status === 'done' && JSON.stringify(result.activations.map(row => row.role)) === JSON.stringify(['intake', 'extractor', 'vendor', 'payables', 'auditor']),
      syntheticCost: close(result?.costUsd, 0.002),
      idempotentCase: again === result && result !== undefined,
      officeHandoffs: publicRows.length === 4 && publicRows.every(row => row.status === 'completed')
        && publicRows.some(row => row.fromRole === 'intake' && row.toRole === 'extractor' && row.status === 'completed')
        && publicRows.some(row => row.fromRole === 'payables' && row.toRole === 'auditor' && row.status === 'completed'),
      ledgerSpend: close(spent, 0.002),
      judgeMetadata: inboxMeta?.scenario_source === 'judge',
      allowAssessment: assessment?.verdict === 'ALLOW',
      holdOnly: payment?.status === 'held' && payment.verdict === 'ESCALATE' && paymentRules.includes('INVALID_INPUT')
        && !paid && await repository.getInvoice('papertrail', '4401') === undefined,
      decisionStands: !!seatBefore && !!seatAfter && seatAfter.decision === 'ALLOW' && input.result.decision.kind === 'ALLOW'
        && JSON.stringify(seatAfter) === JSON.stringify(seatBefore)
        && narrationHold?.id !== seatAfter.id && narrationHold?.decision === 'ESCALATE' && narrationHold.ruleIds.includes('INVALID_INPUT'),
      flagMatrix: optOut.flagMatrix,
      agentsOff: optOut.agentsOff,
      auditChain: (await control.verifyAuditChain()).valid,
      noNetwork: providerRequests === 0,
    };
    return { id: 'inbox-team' as const, match: Object.values(checks).every(Boolean), checks,
      roles: result?.activations.map(row => row.role) ?? [], caseStatus: result?.status ?? null, reason: result?.reason ?? null,
      handoffs: publicRows.map(row => ({ fromRole: row.fromRole, toRole: row.toRole, status: row.status })),
      assessment: assessment?.verdict ?? null,
      payment: payment ? { status: payment.status ?? null, verdict: payment.verdict ?? null, ruleIds: paymentRules } : null,
      seatDecision: seatAfter?.decision ?? null, syntheticCostUsd: result?.costUsd ?? null, providerRequests, optOut: optOut.observed,
      scope: 'Production createInboxAgents (ClaudeAgentRuntime, Dispatcher, role registry, memory handoff store) with an injected scripted QueryFn and a mocked CRS vendor port. Completed office rows are the public handoffs. evaluate_invoice may ALLOW; request_payment is the narration hold-only port and cannot pay. DEMO_AGENTS=0 is measured through demoAgentsEnabled, narrateInbox, and the production inbox HTTP entry, which keeps the recorded seat decision and creates no agent case. Narration appends its own hold and does not rewrite that seat decision. No Anthropic call, network, or dial. Actual provider spend is 0.' };
  } finally { globalThis.fetch = priorFetch; }
}

async function runOptOut(sample: InboxNarration) {
  const flagMatrix = demoAgentsEnabled({ BACKROOM_DEMO: '1' }) === true
    && demoAgentsEnabled({}) === false
    && demoAgentsEnabled({ DEMO_AGENTS: '1' }) === true
    && demoAgentsEnabled({ BACKROOM_DEMO: '1', DEMO_AGENTS: '0' }) === false;
  const prior = process.env.BACKROOM_DEMO;
  const priorAgents = process.env.DEMO_AGENTS;
  process.env.BACKROOM_DEMO = '1';
  process.env.DEMO_AGENTS = '0';
  let narrated: unknown = 'NOT_CALLED';
  let hostCreated = true;
  let httpStatus = 0;
  let agentAudits = true;
  let responseRules: string[] = [];
  let recordedDecision: string | undefined;
  let recordedRules: string[] = [];
  try {
    await resetInboxAgents();
    if (!demoAgentsEnabled()) narrated = await narrateInbox(sample);
    hostCreated = hostSlot().backroomInboxAgents !== undefined;
    const offline = new MemoryStateStore();
    const preset = inboxPresets.find(row => row.id === '4471')!;
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...preset, presetId: preset.id })) form.set(key, value);
    const response = await createInboxHTTP({ store: () => offline })(new Request('http://localhost/api/inbox', {
      method: 'POST', headers: { origin: 'http://localhost' }, body: form }));
    httpStatus = response.status;
    const body = await response.json() as { decision?: { kind?: string; ruleIds?: string[] } };
    const audits = await offline.listAudit();
    const recorded = audits.find(row => row.action === 'judge_inbox_decision');
    responseRules = body.decision?.ruleIds ?? [];
    recordedDecision = recorded?.decision;
    recordedRules = recorded?.ruleIds ?? [];
    agentAudits = audits.some(row => row.action.startsWith('agent_'));
    const sameDecision = recordedDecision === body.decision?.kind && JSON.stringify(recordedRules) === JSON.stringify(responseRules);
    return {
      flagMatrix,
      agentsOff: narrated === undefined && !hostCreated && httpStatus === 200 && responseRules.includes('LOOKALIKE_DOMAIN') && !agentAudits && sameDecision,
      observed: { narrated: narrated !== undefined, hostCreated, httpStatus, agentAudits: audits.filter(row => row.action.startsWith('agent_')).length,
        responseRules, recordedDecision: recordedDecision ?? null, recordedRules },
    };
  } finally {
    await resetInboxAgents();
    if (prior === undefined) delete process.env.BACKROOM_DEMO; else process.env.BACKROOM_DEMO = prior;
    if (priorAgents === undefined) delete process.env.DEMO_AGENTS; else process.env.DEMO_AGENTS = priorAgents;
  }
}
