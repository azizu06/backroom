import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNorthfieldRepository, MemoryStateStore, northfieldInvoice } from '@backroom/orchestrator';
import { FileUsageLedger, MemoryUsageLedger, type QueryFn } from '@backroom/orchestrator/agents';
import { scriptedQuery, type ScriptStep, type ScriptedCall } from '../../../orchestrator/src/agents/mock-query';
import { createInboxAgents, demoAgentsEnabled, type InboxNarration } from './agents';
import { createInboxHTTP } from '../inbox/http';
import { inboxPresets } from '../inbox/presets';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(fn => fn())); vi.unstubAllEnvs(); });
const handoff = (to: string, refs: (outputs: any[]) => string[]): ScriptStep => ({ tool: 'handoff',
  args: outputs => ({ to, reason: 'completed', summary: 'Cited narration; no payment or approval.', artifactRefs: refs(outputs) }) });
function scripts(item: string): (role: string) => ScriptStep[] {
  return role => ({
    intake: [{ tool: 'read_inbox_item', args: { itemRef: item } }, handoff('extractor', () => [item])],
    extractor: [{ tool: 'read_document', args: { documentRef: item, chunk: 0 } },
      { tool: 'local_extract', args: { documentRef: item } },
      { tool: 'validate_extraction', args: (o: any[]) => ({ documentRef: item, fields: o[1].fields }) },
      handoff('vendor', o => [item, o[2].artifactRef])],
    vendor: [{ tool: 'get_vendor_master', args: {} }, { tool: 'check_domain', args: { which: 'sender' } },
      { tool: 'check_domain', args: { which: 'claimed' } }, { tool: 'check_business', args: {} },
      { tool: 'conclude_verification', args: { outcome: 'proceed', note: 'Master, domains and mocked CRS agree.' } },
      handoff('payables', o => [o[4].verdictRef])],
    payables: [{ tool: 'evaluate_invoice', args: {} }, { tool: 'request_payment', args: {} },
      handoff('auditor', o => o[1].evidenceRefs)],
    auditor: [{ tool: 'read_audit', args: {} }, { tool: 'verify_chain', args: {} },
      { tool: 'record_case_summary', args: (o: any[]) => ({ summary: `Narration only [entry:${o[1].auditIds[0]}]`, citations: [o[1].auditIds[0]] }) }],
  })[role] ?? [];
}
async function setup(options: { query?: QueryFn; ledger?: MemoryUsageLedger | FileUsageLedger; calls?: ScriptedCall[]; costUsd?: number } = {}) {
  const control = new MemoryStateStore();
  const repository = await createNorthfieldRepository();
  const fields = northfieldInvoice('4401');
  const item: InboxNarration['item'] = { id: 'judge:sample', source: 'judge', kind: 'invoice', senderDomain: 'papertrail.example', text: 'Invoice 4401; untrusted content.' };
  const entry = await control.appendAudit({ actor: 'code', seat: 'payables', action: 'judge_inbox_decision', ts: Date.now(),
    decision: 'ALLOW', ruleIds: [], policyVersion: 1, refs: [item.id], route: 'code', latencyMs: 0, costUsd: 0,
    inputs: { fields, scenario_source: 'judge' } });
  const input: InboxNarration = { item, fields, repository, auditId: entry.id,
    result: { status: 'held', decision: { kind: 'ALLOW', ruleIds: [], policyVersion: 1 }, evidenceRefs: [item.id] } };
  const host = createInboxAgents({ control, ledger: options.ledger ?? new MemoryUsageLedger(),
    query: options.query ?? scriptedQuery(scripts(item.id), { costUsd: options.costUsd, calls: options.calls }), credential: () => 'mock-key',
    vendor: { bankChangeRisk: { async check() { return { score: 8, label: 'CRS sandbox: test identity #1',
      checkedAt: '2026-10-24T12:00:00Z', responseHash: 'a'.repeat(64) }; } },
    publicRecords: async () => ({ bankruptcies: 0, evidenceRef: `crs:sha256:${'b'.repeat(64)}` }) } });
  cleanups.push(() => host.stop());
  return { control, input, host };
}

describe('judge inbox production role narration', () => {
  it('uses the real role tools, emits office rows and holds a payment request on an ALLOW', async () => {
    const calls: ScriptedCall[] = [];
    const { control, input, host } = await setup({ calls });
    const result = await host.submit(input);
    expect(result?.status, JSON.stringify({ reason: result?.reason, activations: result?.activations.map(a => ({ role: a.role, kind: a.kind, reason: a.reason })), calls })).toBe('done');
    expect(result?.activations.map(row => row.role)).toEqual(['intake', 'extractor', 'vendor', 'payables', 'auditor']);
    expect(result?.costUsd).toBeCloseTo(0.002, 6);
    expect(await host.submit(input)).toBe(result);
    expect(await host.store.listPublic()).toHaveLength(4);
    expect((await host.ledger.usage('aziz')).spentUsd).toBeCloseTo(0.002, 6);
    expect(await host.store.listPublic()).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromRole: 'intake', toRole: 'extractor', status: 'completed' }),
      expect.objectContaining({ fromRole: 'payables', toRole: 'auditor', status: 'completed' }),
    ]));
    expect(calls.find(row => row.tool === 'read_inbox_item')?.output).toMatchObject({ metadata: { scenario_source: 'judge' } });
    expect(calls.find(row => row.tool === 'request_payment')?.output).toMatchObject({ status: 'held', verdict: 'ESCALATE' });
    expect((await control.listAudit()).some(row => ['nessie_completed', 'pay_invoice'].includes(row.action))).toBe(false);
    expect(await input.repository.getInvoice('papertrail', '4401')).toBeUndefined();
    expect(await control.verifyAuditChain()).toMatchObject({ valid: true });
  });
  it('uses the demo case cap and the shared file ledger hard stop', async () => {
    const capped = await setup({ costUsd: 0.125 });
    const result = await capped.host.submit(capped.input);
    expect(result).toMatchObject({ status: 'held', reason: 'CASE_BUDGET', costUsd: 0.5 });
    expect(result?.activations).toHaveLength(4);
    const directory = await mkdtemp(join(tmpdir(), 'inbox-ledger-'));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const path = join(directory, 'usage.json');
    const ledger = new FileUsageLedger(path);
    const spent = await ledger.reserve('aziz', 39.99, 'demo');
    await ledger.settle(spent, 39.99);
    const query = vi.fn(scriptedQuery(() => []));
    const stopped = await setup({ ledger: new FileUsageLedger(path), query });
    expect(await stopped.host.submit(stopped.input)).toMatchObject({ status: 'paused', reason: 'BUDGET_HARD_STOP', costUsd: 0 });
    expect(query).not.toHaveBeenCalled();
    expect((await ledger.usage('aziz')).spentUsd).toBe(39.99);
  });

  it('global OFF creates a paused case with zero SDK queries and reset cancels it', async () => {
    const query = vi.fn(scriptedQuery(() => []));
    const { control, host, input } = await setup({ query });
    await control.setLlmEnabled(false);
    expect(await host.submit(input)).toMatchObject({ status: 'paused', reason: 'LLM_OFF' });
    expect(query).not.toHaveBeenCalled();
    await host.stop();
    expect(await host.store.getCase('agent:judge:sample')).toMatchObject({ status: 'cancelled', reason: 'DEMO_RESET' });
  });

  it('keeps cancellation handles when storage fails so reset can retry safely', async () => {
    const { control, host, input } = await setup();
    await control.setLlmEnabled(false);
    await host.submit(input);
    vi.spyOn(host.store, 'stopCase').mockRejectedValueOnce(new Error('temporary transport failure'));
    await expect(host.stop()).rejects.toThrow('DEMO_AGENT_CANCEL_FAILED');
    expect(await host.store.getCase('agent:judge:sample')).toMatchObject({ status: 'paused' });
    await host.stop();
    expect(await host.store.getCase('agent:judge:sample')).toMatchObject({ status: 'cancelled', reason: 'DEMO_RESET' });
  });

  it('reset succeeds when the dispatcher cancels after the host reads an open case', async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const query: QueryFn = ({ options }) => {
      const stream = (async function* () {
        entered();
        await new Promise<void>(resolve => options.abortController!.signal.addEventListener('abort', () => resolve(), { once: true }));
        throw new Error('Operation aborted');
        yield {} as never;
      })();
      return Object.assign(stream, { close: vi.fn() });
    };
    const { host, input } = await setup({ query });
    const pending = host.submit(input);
    await started;
    const readCase = host.store.getCase.bind(host.store);
    vi.spyOn(host.store, 'getCase').mockImplementationOnce(async caseId => {
      const snapshot = await readCase(caseId);
      expect(snapshot?.status).toBe('open');
      // Pin the real dispatcher cancellation between reset's read and stop requests.
      await pending;
      return snapshot;
    });
    await expect(host.stop()).resolves.toBeUndefined();
    expect(await readCase('agent:judge:sample')).toMatchObject({ status: 'cancelled', reason: 'CANCELLED' });
    expect((await host.ledger.usage('aziz')).reservedUsd).toBe(0);
  });

  it('reset fences an active SDK turn, drains it and refuses new cases', async () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const query: QueryFn = ({ options }) => {
      const stream = (async function* () {
        entered();
        await new Promise<void>(resolve => options.abortController!.signal.addEventListener('abort', () => resolve(), { once: true }));
        throw new Error('Operation aborted');
        yield {} as never;
      })();
      return Object.assign(stream, { close: vi.fn() });
    };
    const { host, input } = await setup({ query });
    const pending = host.submit(input);
    await started;
    await host.stop();
    await pending;
    expect(await host.store.getCase('agent:judge:sample')).toMatchObject({ status: 'cancelled', reason: 'DEMO_RESET' });
    expect(await host.store.listPublic()).toEqual([]);
    expect((await host.ledger.usage('aziz')).reservedUsd).toBe(0);
    expect(await host.submit({ ...input, item: { ...input.item, id: 'judge:after-reset' } })).toBeUndefined();
  });

  it('the flag defaults on only for the demo host; offline opt-out creates no case', async () => {
    expect(demoAgentsEnabled({ BACKROOM_DEMO: '1' })).toBe(true);
    expect(demoAgentsEnabled({})).toBe(false);
    expect(demoAgentsEnabled({ DEMO_AGENTS: '1' })).toBe(true);
    expect(demoAgentsEnabled({ BACKROOM_DEMO: '1', DEMO_AGENTS: '0' })).toBe(false);
    vi.stubEnv('BACKROOM_DEMO', '1');
    vi.stubEnv('DEMO_AGENTS', '0');
    const state = new MemoryStateStore();
    const preset = inboxPresets.find(row => row.id === '4471')!;
    const form = new FormData();
    for (const [key, value] of Object.entries({ ...preset, presetId: preset.id })) form.set(key, value);
    const response = await createInboxHTTP({ store: () => state, origin: () => 'http://localhost' })(new Request('http://localhost/api/inbox', {
      method: 'POST', headers: { origin: 'http://localhost' }, body: form }));
    expect(response.status).toBe(200);
    expect((await response.json()).decision.ruleIds).toContain('LOOKALIKE_DOMAIN');
    expect((await state.listAudit()).some(row => row.action.startsWith('agent_'))).toBe(false);
  });

});
