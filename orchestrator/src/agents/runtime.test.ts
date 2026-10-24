import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BUILTIN_TOOL_NAMES, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Activation, DomainTool, Json, Specialist, ToolContext } from './contracts';
import { scriptedQuery, type ScriptedCall, type ScriptStep } from './mock-query';
import { ClaudeAgentRuntime, type QueryFn } from './runtime';
import { refsIn } from './tools';

const read: DomainTool<Record<string, never>, Json> = { name: 'read_document', description: 'read', input: z.object({}).strict(),
  async execute() { return { invoiceId: 'INV-1', artifactRef: 'case-1:invoice' }; } };
const hold: DomainTool<Record<string, never>, Json> = { name: 'request_payment', description: 'pay', input: z.object({}).strict(),
  async execute() { return { decision: 'ESCALATE', outcome: 'held', ruleIds: ['BANK_CHANGE_HOLD'], artifactRef: 'case-1:hold' }; } };
const spec = (tools = [read], allowedNext: Specialist['allowedNext'] = ['vendor']): Specialist =>
  ({ role: 'extractor', model: 'claude-haiku-5-5', prompt: 'Extract.', tools, allowedNext });
function context(over: Partial<Activation> = {}, current: () => Promise<void> = async () => {}): ToolContext {
  return { activation: { caseId: 'case-1', taskId: 't', activationId: 'case-1:a1', role: 'extractor', leaseOwner: 'runner', leaseToken: 1, llmGeneration: 1,
    artifactRefs: ['doc:1'], credentialOwnerId: 'owner', signal: new AbortController().signal, ...over }, assertCurrent: current };
}
const handoff = (refs: string[], to = 'vendor'): ScriptStep => ({ tool: 'handoff', args: { to, reason: 'done', summary: 'Extracted INV-1', artifactRefs: refs } });
function runtime(steps: ScriptStep[], calls: ScriptedCall[] = [], extra: Partial<ConstructorParameters<typeof ClaudeAgentRuntime>[0]> = {}) {
  let seen: Options | undefined;
  const inner = scriptedQuery(() => steps, { calls });
  const query: QueryFn = (params, defs) => { seen = params.options; return inner(params, defs); };
  return { rt: new ClaudeAgentRuntime({ credential: () => 'test-key', query, ...extra }), options: () => seen! };
}

describe('ClaudeAgentRuntime', () => {
  it('runs one restricted query: no built-ins, empty settings, only role tools plus handoff, bounded', async () => {
    const { rt, options } = runtime([{ tool: 'read_document', args: {} }, handoff(['case-1:invoice'])]);
    const result = await rt.run(spec(), context(), { x: 1 });
    expect(result).toMatchObject({ kind: 'handoff', request: { to: 'vendor', artifactRefs: ['case-1:invoice'] }, usage: { costUsd: 0.0004 } });
    const o = options();
    expect(o.tools).toEqual([]);
    expect(o.disallowedTools).toEqual([...BUILTIN_TOOL_NAMES]);
    expect(o.allowedTools).toEqual(['mcp__backroom__read_document', 'mcp__backroom__handoff']);
    expect(o.settingSources).toEqual([]);
    expect(o).toMatchObject({ persistSession: false, maxTurns: 6, maxBudgetUsd: 0.02, model: 'claude-haiku-5-5', permissionMode: 'dontAsk' });
    expect(Object.keys(o.env!).sort()).toEqual(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'CLAUDE_CONFIG_DIR', 'DISABLE_AUTOUPDATER', 'ENABLE_TOOL_SEARCH', 'HOME', 'PATH']);
    expect(await o.canUseTool!('Bash', {}, {} as never)).toMatchObject({ behavior: 'deny' });
  });

  it('seals after handoff: later tools and a second handoff are refused', async () => {
    const calls: ScriptedCall[] = [];
    const { rt } = runtime([handoff(['doc:1']), { tool: 'read_document', args: {} }, handoff(['doc:1'], 'payables')], calls);
    const result = await rt.run(spec([read], ['vendor', 'payables']), context(), {});
    expect(result).toMatchObject({ kind: 'handoff', request: { to: 'vendor' } });
    expect(calls.slice(1).map(c => c.denied)).toEqual(['Handoff staged; activation sealed', 'Handoff staged; activation sealed']);
  });

  it('refuses refs neither given nor returned by code, and destinations outside the graph', async () => {
    const calls: ScriptedCall[] = [];
    const { rt } = runtime([handoff(['case-1:forged']), handoff(['doc:1'], 'auditor')], calls);
    expect(await rt.run(spec(), context(), {})).toMatchObject({ kind: 'done' });
    expect(calls[0]!.output).toMatchObject({ error: 'HANDOFF_UNKNOWN_REF' });
    expect(calls[1]!.output).toMatchObject({ error: 'HANDOFF_EDGE_NOT_ALLOWED', allowed: ['vendor'] });
  });

  it('turns a code-owned held output into a held result and fences stale activations', async () => {
    const { rt } = runtime([{ tool: 'request_payment', args: {} }]);
    expect(await rt.run(spec([hold], []), context(), {})).toMatchObject({ kind: 'held', artifactRefs: ['case-1:hold'] });
    let stale = false;
    const calls: ScriptedCall[] = [];
    const fenced = runtime([{ tool: 'read_document', args: {} }], calls);
    const ctx = context({}, async () => { if (stale) throw new Error('AGENT_LEASE_STALE'); });
    const pending = fenced.rt.run(spec(), ctx, {});
    stale = true;
    await pending;
    expect(calls[0]!.output).toEqual({ error: 'AGENT_LEASE_STALE' });
  });

  it('pauses before any query when OFF or cancelled', async () => {
    const off = new AbortController(); off.abort('LLM_OFF');
    const { rt } = runtime([]);
    expect(await rt.run(spec(), context({ signal: off.signal }), {})).toEqual({ kind: 'paused', reason: 'LLM_OFF' });
  });

  it('treats absent or zeroed accounting as unknown, never free', async () => {
    const zero: QueryFn = () => Object.assign((async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's', tools: [] } as unknown as SDKMessage;
      yield { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's', total_cost_usd: 0, modelUsage: {} } as unknown as SDKMessage;
    })(), { close() {} });
    const rt = new ClaudeAgentRuntime({ credential: () => 'k', query: zero });
    const result = await rt.run(spec(), context(), {});
    expect(result.kind).toBe('failed');
    expect(Number.isNaN(result.usage!.costUsd)).toBe(true);
  });

  it('fails closed when the SDK reports a tool outside the allowlist', async () => {
    const leak: QueryFn = () => Object.assign((async function* () {
      yield { type: 'system', subtype: 'init', session_id: 's', tools: ['Bash'] } as unknown as SDKMessage;
    })(), { close() {} });
    expect(await new ClaudeAgentRuntime({ credential: () => 'k', query: leak }).run(spec(), context(), {})).toMatchObject({ kind: 'failed', reason: 'UNEXPECTED_TOOLS' });
  });

  it('collects only code-owned ref fields from tool outputs', () => {
    expect(refsIn({ artifactRef: 'a:1', verdictRef: 'v:1', evidenceRefs: ['e:1', 'bad ref'], allowedRefs: ['x:1'], note: 'n:1' }).sort())
      .toEqual(['a:1', 'e:1', 'v:1', 'x:1']);
  });
});
