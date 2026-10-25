import { describe, expect, it, vi } from 'vitest';
import { MemoryStateStore } from '../../store';
import { MemoryEmailOutbox } from '../../collections/email';
import type { PreCallDependencies, PreCallInput } from '../../collections';
import type { DialInput } from '../../voice';
import type { ActivationResult, AgentRuntime, Specialist, ToolContext, UsageReceipt } from '../contracts';
import type { CollectionsCase } from '../tools/collections';
import { classifyCall, routeOutcome, runCollectionsPlanner, runCollectionsPostCall, type CallRecordView } from './collections';

const usage: UsageReceipt = { activationId: 'a1', sessionId: 's', costUsd: 0.001, modelUsage: {}, wallMs: 1, initMs: 1 };
const precall = (): PreCallInput => ({
  clientId: 'client-1042', invoiceId: '1042', testIdentityId: 7,
  company: { name: 'Real public business', website: 'https://example.com' },
  context: { client: { type: 'business', phoneNumber: '+15555550100', dnc: false, localWeekday: 1, localHour: 10,
    consent: { source: 'judge', text: 'I consent', timestamp: '2026-10-23T18:00:00Z', number: '+15555550100' } } },
});
const dial = (): DialInput => ({ sessionId: 'sess-1', agentId: 'agent', fromNumberId: 'num', clientId: 'client-1042', businessName: 'Northfield', contactName: 'Jordan',
  invoiceId: '1042', callbackNumber: '+15555550111', client: { type: 'business', number: '+15555550100', timeZone: 'America/Los_Angeles', dnc: false } });
const caseState = (): CollectionsCase => ({ sessionId: 'sess-1', invoice: { amountCents: 120000, currency: 'USD', daysPastDue: 21 }, precall: precall(), dial: dial() });
const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({ activation: { caseId: 'case-1', taskId: 't', activationId: 'a1', role: 'collections', leaseOwner: 'w', leaseToken: 1,
  llmGeneration: 1, artifactRefs: [], credentialOwnerId: 'o', signal: new AbortController().signal }, assertCurrent: async () => {}, ...over });

function harness(mutate: (c: CollectionsCase) => void = () => {}) {
  const store = new MemoryStateStore();
  const voice = { start: vi.fn(async () => ({ sessionId: 'sess-1', callId: 'call-9' })) };
  const live = caseState();
  const precallDeps: PreCallDependencies = {
    credit: { check: vi.fn(async () => ({ testIdentityId: 7, ofacStatus: 'clear' as const, activeSignals: [], evidence: [] })) },
    health: { check: vi.fn(async () => ({ signals: [] })) },
    planner: { draft: vi.fn(async () => ({ output: { tone: 'neutral' as const, offerOrder: ['pay_in_full' as const],
      plan: { installments: 1, firstPaymentPct: 100, totalDays: 0, waiveFees: false, discountPct: 0 } }, route: 'cloud', model: 'm', latencyMs: 1, costUsd: 0 })) },
    audit: store, escalate: vi.fn(async () => {}),
  };
  mutate(live);
  const deps = { cases: { load: vi.fn(async () => structuredClone(live)) }, voice, precall: precallDeps };
  return { deps, voice, live, store, precallDeps };
}
/** Stands in for the model: runs a fixed tool script through each tool's own input schema. */
function scripted(script: (call: (name: string, input?: unknown) => Promise<unknown>) => Promise<ActivationResult>): AgentRuntime & { specs: Specialist[] } {
  const specs: Specialist[] = [];
  return { specs, async run(spec, c) {
    specs.push(spec);
    return script(async (name, input = {}) => {
      const tool = spec.tools.find(t => t.name === name);
      if (!tool) throw new Error(`no tool ${name}`);
      return tool.execute(c, tool.input.parse(input));
    });
  } };
}
const done: ActivationResult = { kind: 'done', artifactRefs: [], usage };
const happy = scripted(async call => { await call('get_invoice_context'); await call('can_call'); await call('run_precall'); await call('start_call'); return done; });

describe('collections planner specialist', () => {
  it('queues a simulated C14 email from trusted case data after a completed planner refusal, without dialing', async () => {
    const h = harness(c => { c.precall.context.client!.type = 'consumer'; });
    h.live.emailContact = { address: 'billing@client.example' };
    const outbox = new MemoryEmailOutbox();
    const rt = scripted(async call => {
      expect(await call('can_call')).toMatchObject({ decision: 'DENY', ruleIds: ['B2B_ONLY_CALLS'] });
      return done;
    });
    const run = await runCollectionsPlanner(rt, ctx(), { ...h.deps, emailFollowUp: { outbox } });
    expect(run).toMatchObject({ kind: 'not_started', email: { status: 'queued', withLink: false } });
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]!.label).toBe('SIMULATED: email preview, not sent');
    expect(outbox.sent[0]!.body).toContain('AI assistant');
    expect(outbox.sent[0]!.body).not.toContain('120000');
    expect(h.voice.start).not.toHaveBeenCalled();
    expect((await h.store.listAudit()).some(row => row.action === 'email_followup_queued')).toBe(true);
  });

  it('re-reads the trusted stop state after the model finishes, before attempting email fallback', async () => {
    const h = harness(c => { c.precall.context.client!.type = 'consumer'; });
    h.live.emailContact = { address: 'billing@client.example' };
    const outbox = new MemoryEmailOutbox();
    const rt = scripted(async call => {
      await call('can_call');
      h.live.precall.context.signals = { disputed: true };
      return done;
    });
    const run = await runCollectionsPlanner(rt, ctx(), { ...h.deps, emailFollowUp: { outbox } });
    expect(run).toMatchObject({ kind: 'not_started', email: { status: 'blocked', reason: 'DISPUTE_STOP' } });
    expect(outbox.sent).toHaveLength(0);
  });

  it.each(['paused', 'failed'] as const)('does not email after a %s runtime result', async kind => {
    const h = harness(c => { c.precall.context.client!.type = 'consumer'; });
    h.live.emailContact = { address: 'billing@client.example' };
    const outbox = new MemoryEmailOutbox();
    const rt: AgentRuntime = { run: async () => ({ kind, reason: 'TEST_STOP' }) };
    await runCollectionsPlanner(rt, ctx(), { ...h.deps, emailFollowUp: { outbox } });
    expect(outbox.sent).toHaveLength(0);
    expect(h.deps.cases.load).not.toHaveBeenCalled();
  });

  it('fences the email queue immediately before the effect', async () => {
    const h = harness(c => { c.precall.context.client!.type = 'consumer'; });
    h.live.emailContact = { address: 'billing@client.example' };
    const outbox = new MemoryEmailOutbox();
    const rt = scripted(async () => done);
    const fenced = ctx({ fence: () => { throw new Error('STALE_LEASE'); } });
    await expect(runCollectionsPlanner(rt, fenced, { ...h.deps, emailFollowUp: { outbox } })).rejects.toThrow('STALE_LEASE');
    expect(outbox.sent).toHaveLength(0);
  });

  it.each([false, true])('does not queue a stale preview if contact policy changes during the final ownership check (shared case=%s)', async shared => {
    const h = harness(c => { c.precall.context.client!.type = 'consumer'; });
    h.live.emailContact = { address: 'billing@client.example' };
    if (shared) h.deps.cases.load = vi.fn(async () => h.live);
    const outbox = new MemoryEmailOutbox();
    let checks = 0;
    const changing = ctx({ assertCurrent: async () => {
      if (++checks === 3) h.live.precall.context.signals = { disputed: true };
    } });
    await expect(runCollectionsPlanner(scripted(async () => done), changing, { ...h.deps, emailFollowUp: { outbox } }))
      .rejects.toThrow('EMAIL_CASE_CHANGED');
    expect(outbox.sent).toHaveLength(0);
  });

  it('prepares and starts one call through the voice layer', async () => {
    const h = harness();
    const run = await runCollectionsPlanner(happy, ctx(), h.deps);
    expect(run).toMatchObject({ kind: 'started', callId: 'call-9', sessionId: 'sess-1' });
    expect(h.voice.start).toHaveBeenCalledTimes(1);
    expect(h.voice.start).toHaveBeenCalledWith(h.live.dial);
    const actions = (await h.store.listAudit()).map(a => a.action);
    expect(actions).toEqual(expect.arrayContaining(['can_call', 'pre_call_permit', 'plan_validated', 'dial_permit', 'collections_call_started']));
    expect(happy.specs[0]!).toMatchObject({ role: 'collections', model: 'claude-haiku-5-5', allowedNext: [] });
    expect(happy.specs[0]!.tools.map(t => t.name)).toEqual(['get_invoice_context', 'can_call', 'run_precall', 'start_call']);
  });
  it('exposes no contact details to the model and rejects model-supplied identity fields', async () => {
    const h = harness();
    const seen: unknown[] = [];
    const rt = scripted(async call => { seen.push(await call('get_invoice_context')); await expect(call('start_call', { role: 'payables', phone: '+15550000000' })).rejects.toThrow('Unrecognized keys'); return done; });
    await runCollectionsPlanner(rt, ctx(), h.deps);
    expect(JSON.stringify(seen)).not.toMatch(/\+1555|Jordan|Northfield|example\.com/);
    expect(h.voice.start).not.toHaveBeenCalled();
  });
  it('denies start_call before a ready pre-call', async () => {
    const h = harness();
    const rt = scripted(async call => { expect(await call('start_call')).toMatchObject({ status: 'DENY', reason: 'PRECALL_NOT_READY' }); return done; });
    expect(await runCollectionsPlanner(rt, ctx(), h.deps)).toMatchObject({ kind: 'not_started' });
    expect(h.voice.start).not.toHaveBeenCalled();
  });
  it.each([
    ['bankruptcy', (c: CollectionsCase) => { c.precall.context.signals = { bankruptcy: true }; }, 'BANKRUPTCY_STOP'],
    ['opt-out', (c: CollectionsCase) => { c.precall.context.client!.dnc = true; }, 'DNC'],
    ['calling hours', (c: CollectionsCase) => { c.precall.context.client!.localHour = 18; }, 'CALL_WINDOW'],
    ['consumer', (c: CollectionsCase) => { c.precall.context.client!.type = 'consumer'; }, 'B2B_ONLY_CALLS'],
  ])('never dials under the %s stop', async (_n, mutate, rule) => {
    const h = harness(mutate);
    const rt = scripted(async call => {
      expect(await call('can_call')).toMatchObject({ ruleIds: [rule] });
      expect(await call('run_precall')).toMatchObject({ status: 'blocked' });
      expect(await call('start_call')).toMatchObject({ status: 'DENY' });
      return done;
    });
    expect(await runCollectionsPlanner(rt, ctx(), h.deps)).toMatchObject({ kind: 'not_started' });
    expect(h.voice.start).not.toHaveBeenCalled();
  });
  it('re-reads state at the dial boundary: a stop that lands after pre-call blocks the dial', async () => {
    const h = harness();
    const rt = scripted(async call => {
      await call('run_precall');
      h.live.precall.context.client!.dnc = true; // opt-out recorded between pre-call and dial
      expect(await call('start_call')).toMatchObject({ status: 'DENY', ruleIds: ['DNC'] });
      return done;
    });
    await runCollectionsPlanner(rt, ctx(), h.deps);
    expect(h.voice.start).not.toHaveBeenCalled();
  });
  it('pauses on LLM_OFF and does not dial', async () => {
    const h = harness();
    h.precallDeps.planner.draft = vi.fn(async () => ({ kind: 'LLM_OFF' as const, route: 'code' as const, model: 'none' as const, latencyMs: 0 as const, costUsd: 0 as const }));
    const rt = scripted(async call => { expect(await call('run_precall')).toMatchObject({ status: 'paused', reason: 'LLM_OFF' }); await call('start_call'); return done; });
    expect(await runCollectionsPlanner(rt, ctx(), h.deps)).toMatchObject({ kind: 'not_started' });
    expect(h.voice.start).not.toHaveBeenCalled();
  });
  it('is fenced by assertCurrent before any read or effect', async () => {
    const h = harness();
    const stale = ctx({ assertCurrent: async () => { throw new Error('STALE_LEASE'); } });
    await expect(runCollectionsPlanner(happy, stale, h.deps)).rejects.toThrow('STALE_LEASE');
    expect(h.voice.start).not.toHaveBeenCalled();
    expect(h.deps.cases.load).not.toHaveBeenCalled();
  });
  it('dials once even if the model calls start_call twice', async () => {
    const h = harness();
    const rt = scripted(async call => { await call('run_precall'); await call('start_call'); expect(await call('start_call')).toMatchObject({ status: 'already_started' }); return done; });
    await runCollectionsPlanner(rt, ctx(), h.deps);
    expect(h.voice.start).toHaveBeenCalledTimes(1);
  });
  it('rejects a handoff from the planner', async () => {
    const h = harness();
    const rt: AgentRuntime = { run: async () => ({ kind: 'handoff', request: { to: 'reconciler', reason: 'x', summary: 'x', artifactRefs: [] }, usage }) };
    expect(await runCollectionsPlanner(rt, ctx(), h.deps)).toMatchObject({ kind: 'not_started', result: { kind: 'failed', reason: 'PLANNER_HANDOFF_NOT_ALLOWED' } });
  });
});

const call = (over: Partial<CallRecordView> = {}): CallRecordView => ({ callId: 'sess-1', status: 'active', plans: [], escalations: [], links: [], ...over });
describe('collections post-call routing', () => {
  it.each([
    ['opt_out', { status: 'opted_out' }, { kind: 'terminal', result: 'done' }],
    ['human_requested', { status: 'human_requested' }, { kind: 'terminal', result: 'held' }],
    ['dispute', { status: 'disputed' }, { kind: 'terminal', result: 'held' }],
    ['already_paid', { status: 'already_paid' }, { kind: 'handoff', to: 'reconciler' }],
    ['payment_link_sent', { links: [{ id: 'l1' }], plans: [{ id: 'p1' }] }, { kind: 'handoff', to: 'reconciler' }],
    ['plan_approved', { plans: [{ id: 'p1' }] }, { kind: 'handoff', to: 'reconciler' }],
    ['approval_pending', { escalations: [{ id: 'e1', status: 'pending' }] }, { kind: 'terminal', result: 'held' }],
    ['approval_pending', { escalations: [{ id: 'e1', status: 'expired' }] }, { kind: 'terminal', result: 'held' }],
    ['no_agreement', {}, { kind: 'terminal', result: 'held' }],
  ] as const)('%s', (outcome, over, route) => {
    expect(classifyCall(call(over as Partial<CallRecordView>))).toBe(outcome);
    expect(routeOutcome(outcome)).toEqual(route);
  });
  it('a stop outranks a payment link', () => {
    expect(classifyCall(call({ status: 'opted_out', links: [{ id: 'l1' }], plans: [{ id: 'p1' }] }))).toBe('opt_out');
  });
});

function postHarness(record: CallRecordView | undefined) {
  const h = harness();
  const deps = { cases: h.deps.cases, outcomes: { read: vi.fn(async () => record) }, audit: h.store };
  return { ...h, deps };
}
describe('collections post-call step', () => {
  const handoff = (over = {}): ActivationResult => ({ kind: 'handoff', usage,
    request: { to: 'reconciler', reason: 'Caller says paid', summary: 'Already-paid claim on 1042; verify bank evidence.', artifactRefs: ['case-1:call:sess-1'], ...over } });
  it('hands an already-paid claim to the reconciler with validated refs', async () => {
    const h = postHarness(call({ status: 'already_paid' }));
    const rt = scripted(async c => { expect(await c('get_call_outcome')).toMatchObject({ outcome: 'already_paid', allowedRefs: ['case-1:call:sess-1'] }); return handoff(); });
    expect(await runCollectionsPostCall(rt, ctx(), h.deps)).toMatchObject({ kind: 'handoff', request: { to: 'reconciler' } });
    expect(rt.specs[0]!).toMatchObject({ role: 'collections', allowedNext: ['reconciler'] });
    expect(rt.specs[0]!.tools.map(t => t.name)).toEqual(['get_call_outcome']);
    expect((await h.store.listAudit()).at(-1)).toMatchObject({ action: 'collections_postcall_handoff' });
  });
  it('hands a payment-link outcome to the reconciler citing plan and link', async () => {
    const h = postHarness(call({ plans: [{ id: 'p1' }], links: [{ id: 'l1' }] }));
    const rt = scripted(async () => handoff({ artifactRefs: ['case-1:call:sess-1', 'case-1:plan:p1', 'case-1:link:l1'] }));
    expect(await runCollectionsPostCall(rt, ctx(), h.deps)).toMatchObject({ kind: 'handoff' });
  });
  it.each([
    ['opt-out', { status: 'opted_out' }, 'done'], ['dispute', { status: 'disputed' }, 'held'], ['bankruptcy/human', { status: 'human_requested' }, 'held'],
  ] as const)('%s ends terminally without invoking a model', async (_n, over, kind) => {
    const h = postHarness(call(over as Partial<CallRecordView>));
    const rt: AgentRuntime = { run: vi.fn() };
    expect(await runCollectionsPostCall(rt, ctx(), h.deps)).toMatchObject({ kind, artifactRefs: ['case-1:call:sess-1'] });
    expect(rt.run).not.toHaveBeenCalled();
  });
  it.each([
    ['wrong destination', { to: 'auditor' }], ['foreign ref', { artifactRefs: ['case-2:call:x'] }], ['no refs', { artifactRefs: [] }], ['oversized summary', { summary: 'x'.repeat(401) }],
  ])('fails closed on a %s', async (_n, over) => {
    const h = postHarness(call({ status: 'already_paid' }));
    const rt = scripted(async () => handoff(over));
    expect(await runCollectionsPostCall(rt, ctx(), h.deps)).toMatchObject({ kind: 'failed', reason: 'POSTCALL_HANDOFF_INVALID' });
  });
  it('fails closed when the model does not hand off a reconcilable outcome', async () => {
    const h = postHarness(call({ status: 'already_paid' }));
    expect(await runCollectionsPostCall(scripted(async () => done), ctx(), h.deps)).toMatchObject({ kind: 'failed', reason: 'POSTCALL_HANDOFF_EXPECTED' });
  });
  it('rejects a missing call record and stale ownership', async () => {
    await expect(runCollectionsPostCall(scripted(async () => done), ctx(), postHarness(undefined).deps)).rejects.toThrow('CALL_RECORD_NOT_FOUND');
    const stale = ctx({ assertCurrent: async () => { throw new Error('STALE_LEASE'); } });
    await expect(runCollectionsPostCall(scripted(async () => done), stale, postHarness(call()).deps)).rejects.toThrow('STALE_LEASE');
  });
});

describe('judge-supplied calls (#30)', () => {
  const handoff = (): ActivationResult => ({ kind: 'handoff', usage,
    request: { to: 'reconciler', reason: 'Caller says paid', summary: 'Already-paid claim; verify bank evidence.', artifactRefs: ['case-1:call:sess-1'] } });
  it('an unknown call status is never routed onward: it escalates to a human', async () => {
    const odd = call({ status: 'transferred_to_ai' as never, links: [{ id: 'l1' }], plans: [{ id: 'p1' }], scenarioSource: 'judge' });
    expect(classifyCall(odd)).toBe('unrecognized');
    expect(routeOutcome('unrecognized')).toEqual({ kind: 'terminal', result: 'held' });
    const h = postHarness(odd);
    const rt = scripted(async () => { throw new Error('model must not run'); });
    expect(await runCollectionsPostCall(rt, ctx(), h.deps)).toMatchObject({ kind: 'held' });
    expect(rt.specs).toEqual([]);
    expect((await h.store.listAudit()).find(a => a.action === 'collections_postcall_terminal')).toMatchObject({
      decision: 'ESCALATE', ruleIds: ['CALL_UNRECOGNIZED'], inputs: { outcome: 'unrecognized', result: 'held', scenario_source: 'judge' } });
  });
  it.each([
    ['dispute', { status: 'disputed' }, 'CALL_DISPUTE'],
    ['wrong number / human', { status: 'human_requested' }, 'CALL_HUMAN_REQUESTED'],
    ['no agreement', {}, 'CALL_NO_AGREEMENT'],
  ] as const)('a judge %s holds as ESCALATE, never a pass', async (_name, over, rule) => {
    const h = postHarness(call({ ...over, scenarioSource: 'judge' } as Partial<CallRecordView>));
    expect(await runCollectionsPostCall(scripted(async () => done), ctx(), h.deps)).toMatchObject({ kind: 'held' });
    expect((await h.store.listAudit()).find(a => a.action === 'collections_postcall_terminal')).toMatchObject({
      decision: 'ESCALATE', ruleIds: [rule], inputs: { scenario_source: 'judge' } });
  });
  it('a judge opt-out stops as done without escalating, and is tagged', async () => {
    const h = postHarness(call({ status: 'opted_out', scenarioSource: 'judge' }));
    expect(await runCollectionsPostCall(scripted(async () => done), ctx(), h.deps)).toMatchObject({ kind: 'done' });
    const row = (await h.store.listAudit()).find(a => a.action === 'collections_postcall_terminal');
    expect(row?.decision).toBeUndefined();
    expect(row?.inputs).toMatchObject({ outcome: 'opt_out', scenario_source: 'judge' });
  });
  it('a judge already-paid claim is handed to the reconciler and tagged; seeded calls stay seed', async () => {
    const judge = postHarness(call({ status: 'already_paid', scenarioSource: 'judge' }));
    expect(await runCollectionsPostCall(scripted(async () => handoff()), ctx(), judge.deps)).toMatchObject({ kind: 'handoff' });
    expect((await judge.store.listAudit()).find(a => a.action === 'collections_postcall_handoff')?.inputs).toMatchObject({ scenario_source: 'judge' });
    const seeded = postHarness(call({ status: 'already_paid' }));
    await runCollectionsPostCall(scripted(async () => handoff()), ctx(), seeded.deps);
    expect((await seeded.store.listAudit()).find(a => a.action === 'collections_postcall_handoff')?.inputs).toMatchObject({ scenario_source: 'seed' });
  });
});
