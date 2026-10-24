import { afterEach, expect, it, vi } from 'vitest';
import { createGateway } from '../../../../web/lib/gateway/http';
import { MemoryGatewayStore } from '../../../../web/lib/gateway/store';
import { northfield } from '../../payables';
import { MemoryStateStore } from '../../store';
import type { AgentRuntime, ToolContext } from '../contracts';
import { runCollectionsPostCall } from '../roles/collections';
import { JUDGE_CASES, runJudgeCase, type JudgeCase } from './judge';

const orderCtx = (): ToolContext => ({
  activation: { caseId: 'case-order', taskId: 't', activationId: 'a1', role: 'collections', leaseOwner: 'w', leaseToken: 1,
    llmGeneration: 1, artifactRefs: [], credentialOwnerId: 'offline', signal: new AbortController().signal },
  assertCurrent: async () => {},
});

/** Known authenticated judge call through the real gateway handler, then runCollectionsPostCall. */
async function driveTools(tools: string[]) {
  const invoice = northfield.arInvoices.find(row => row.id === '1042')!;
  const callId = 'judge-order';
  const state = new MemoryStateStore();
  const gateway = new MemoryGatewayStore([{ callId, invoiceId: invoice.id, clientId: invoice.clientId, contactName: 'Jordan',
    companyName: northfield.company.name, amountCents: invoice.principalCents + invoice.lateFeeCents,
    receivable: { principalCents: invoice.principalCents, lateFeeCents: invoice.lateFeeCents }, currency: 'USD', policyVersion: 1,
    scenarioSource: 'judge', identityConfirmed: false, status: 'active', audits: [], plans: [], escalations: [], links: [], outbox: [], deliveries: {} }], state);
  const handle = createGateway({ secret: () => 'eval-offline-secret', store: gateway });
  const responses: { tool: string; status: number; body: { kind?: string; rule_ids?: string[]; speak?: string } }[] = [];
  for (const [index, tool] of tools.entries()) {
    const response = await handle(tool, new Request(`http://offline.invalid/api/tools/${tool}`, {
      method: 'POST', headers: { authorization: 'Bearer eval-offline-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ call_id: callId, webhook_request_id: `${callId}:${index}` }) }));
    responses.push({ tool, status: response.status, body: await response.json() });
  }
  const call = await gateway.transact(callId, current => structuredClone(current));
  const runtime: AgentRuntime = { run: vi.fn() };
  const result = await runCollectionsPostCall(runtime, orderCtx(), {
    cases: { load: async () => ({ sessionId: callId, precall: { clientId: invoice.clientId, invoiceId: invoice.id } } as never) },
    outcomes: { read: async id => id === callId ? call : undefined },
    audit: state,
  });
  return { responses, call, result, runtime, audits: await state.listAudit() };
}

afterEach(() => vi.unstubAllGlobals());

it.each(Object.keys(JUDGE_CASES) as JudgeCase[])('judge %s: unrecognized ends ESCALATE, every row tagged scenario_source judge', async name => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await runJudgeCase(name);
  expect(run.checks).toEqual(Object.fromEntries(Object.keys(run.checks).map(key => [key, true])));
});

it('an invented tool is answered with ESCALATE, not an error, and pauses the call', async () => {
  const run = await runJudgeCase('invented_tool');
  expect(run.responses.at(-1)).toEqual({ tool: 'apply_owner_discount', status: 200, kind: 'ESCALATE' });
  expect(run).toMatchObject({ callStatus: 'human_requested', caseStatus: 'held', terminalDecision: 'ESCALATE' });
});

it('refund_late_fee then report_already_paid keeps the human hold and does not hand off', async () => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await driveTools(['refund_late_fee', 'report_already_paid']);
  expect(run.responses).toEqual([
    expect.objectContaining({ tool: 'refund_late_fee', status: 200, body: expect.objectContaining({ kind: 'ESCALATE', rule_ids: ['UNRECOGNIZED_REQUEST'] }) }),
    expect.objectContaining({ tool: 'report_already_paid', status: 200, body: expect.objectContaining({ kind: 'RECORDED' }) }),
  ]);
  expect(run.call.status).toBe('human_requested');
  expect(run.result).toMatchObject({ kind: 'held' });
  expect(run.runtime.run).not.toHaveBeenCalled();
  expect(run.audits.find(row => row.action === 'collections_postcall_terminal')).toMatchObject({
    decision: 'ESCALATE', ruleIds: ['CALL_HUMAN_REQUESTED'] });
  expect(run.audits.some(row => row.decision === 'ALLOW' || row.action === 'collections_postcall_handoff')).toBe(false);
  const dispatched = await runJudgeCase('invented_then_paid');
  expect(dispatched.responses.slice(-2)).toEqual([
    { tool: 'refund_late_fee', status: 200, kind: 'ESCALATE' },
    { tool: 'report_already_paid', status: 200, kind: 'RECORDED' },
  ]);
  expect(dispatched).toMatchObject({
    callStatus: 'human_requested', caseStatus: 'held', terminalDecision: 'ESCALATE',
    terminalRuleIds: ['CALL_HUMAN_REQUESTED'], runtimeCalls: 0, handoffs: 0,
  });
});

it.each([
  ['record_opt_out', 'refund_late_fee'],
  ['refund_late_fee', 'record_opt_out'],
] as const)('%s then %s stays opted out and done with no runtime call', async (...tools) => {
  vi.stubGlobal('fetch', async () => { throw new Error('UNEXPECTED_NETWORK'); });
  const run = await driveTools([...tools]);
  expect(run.call.status).toBe('opted_out');
  expect(run.result).toMatchObject({ kind: 'done' });
  expect(run.runtime.run).not.toHaveBeenCalled();
  expect(run.audits.find(row => row.action === 'collections_postcall_terminal')?.decision).toBeUndefined();
  expect(run.audits.some(row => row.decision === 'ALLOW' || row.action === 'collections_postcall_handoff')).toBe(false);
});
