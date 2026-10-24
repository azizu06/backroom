import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { mcpName } from './tools';
import type { QueryFn } from './runtime';

/** One scripted model turn: call a tool with these args (resolved against prior outputs). */
export type ScriptStep = { tool: string; args: Record<string, unknown> | ((outputs: unknown[]) => Record<string, unknown>) };
export interface ScriptedCall { role: string; tool: string; denied?: string; output?: unknown; isError?: boolean }

/** Network-free stand-in for the SDK query. It runs the PreToolUse gate and the real MCP
 * handlers the runtime built, then emits init + one cumulative result like the SDK. */
export function scriptedQuery(scriptFor: (role: string) => ScriptStep[], options: { costUsd?: number; calls?: ScriptedCall[] } = {}): QueryFn {
  return ({ options: sdk }, definitions) => {
    const role = /Backroom (\w+) agent/.exec(String(sdk.systemPrompt))?.[1] ?? 'unknown';
    let closed = false;
    async function* run(): AsyncGenerator<SDKMessage> {
      const session = `mock-${role}-${Math.random().toString(36).slice(2, 8)}`;
      yield { type: 'system', subtype: 'init', session_id: session, tools: definitions.map(d => mcpName(d.name)), model: sdk.model } as SDKMessage;
      const outputs: unknown[] = [];
      for (const step of scriptFor(role)) {
        if (closed || sdk.abortController?.signal.aborted) throw new Error('Operation aborted');
        const name = mcpName(step.tool);
        const gate = sdk.hooks?.PreToolUse?.[0]?.hooks[0];
        const decision = await gate?.({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: {} } as never, undefined, { signal: new AbortController().signal }) as
          { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } } | undefined;
        const definition = definitions.find(d => d.name === step.tool);
        if (decision?.hookSpecificOutput?.permissionDecision === 'deny' || !definition) {
          options.calls?.push({ role, tool: step.tool, denied: decision?.hookSpecificOutput?.permissionDecisionReason ?? 'missing' });
          continue;
        }
        const args = typeof step.args === 'function' ? step.args(outputs) : step.args;
        const result = await definition.handler(args as never, {});
        const output = JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : 'null');
        outputs.push(output);
        options.calls?.push({ role, tool: step.tool, output, ...(result.isError ? { isError: true } : {}) });
      }
      yield { type: 'result', subtype: 'success', is_error: false, session_id: session, num_turns: outputs.length + 1,
        total_cost_usd: options.costUsd ?? 0.0004, modelUsage: { [String(sdk.model)]: { costUSD: options.costUsd ?? 0.0004 } },
        result: 'done', permission_denials: [] } as unknown as SDKMessage;
    }
    const iterator = run();
    return Object.assign(iterator, { close() { closed = true; } });
  };
}
