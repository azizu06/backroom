import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRuntime, Json, Specialist, ToolContext } from '../contracts';
import { ClaudeAgentRuntime, type QueryFn } from '../runtime';
import type { AgentCaseStore } from '../handoff-store';
import { mcpName } from '../tools';

export type ToolCall = (name: string, args?: Record<string, unknown>) => Promise<Record<string, Json>>;
/** Scripted query seam inside the production SDK adapter. Uses its MCP schemas, seal and artifacts. */
export function mockRuntime(store: AgentCaseStore,
  script: (spec: Specialist, ctx: ToolContext, call: ToolCall) => Promise<void>,
  onTool: (role: Specialist['role'], name: string, output: Json) => void): AgentRuntime {
  return { async run(spec, ctx, input) {
    const query: QueryFn = ({ options }, definitions) => {
      let closed = false;
      async function* messages(): AsyncGenerator<SDKMessage> {
        const session = `offline:${ctx.activation.activationId}`;
        yield { type: 'system', subtype: 'init', session_id: session,
          tools: definitions.map(d => mcpName(d.name)), model: options.model } as SDKMessage;
        const call: ToolCall = async (name, args = {}) => {
          if (closed || options.abortController?.signal.aborted) throw new Error('MOCK_QUERY_ABORTED');
          const tool = definitions.find(row => row.name === name);
          if (!tool) throw new Error(`MOCK_TOOL_MISSING:${name}`);
          const result = await tool.handler(args as never, {});
          const output = JSON.parse(result.content[0]?.type === 'text' ? result.content[0].text : 'null');
          onTool(spec.role, name, output);
          if (result.isError) throw new Error(`MOCK_TOOL_ERROR:${name}`);
          return output;
        };
        await script(spec, ctx, call);
        // Positive SYNTHETIC accounting: production correctly treats zero as unknown.
        yield { type: 'result', subtype: 'success', is_error: false, session_id: session,
          total_cost_usd: 0.000001, modelUsage: { mock: { costUSD: 0.000001 } }, result: 'offline scripted turn',
          permission_denials: [], num_turns: 1 } as unknown as SDKMessage;
      }
      return Object.assign(messages(), { close() { closed = true; } });
    };
    return new ClaudeAgentRuntime({ credential: () => 'offline-no-key-no-network', query,
      recordArtifacts: (c, refs) => store.recordArtifacts(c, refs) }).run(spec, ctx, input);
  } };
}
