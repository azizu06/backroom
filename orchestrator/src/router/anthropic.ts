import { ModelFailure } from './failure';
import type { AnthropicContent } from './document';

/** Direct, server-only Messages transport. No SDK retries or provider failover. */
export interface AnthropicMessage {
  model: string;
  stop_reason: string;
  content: { type: string; text?: string }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number };
  };
}

// Standard first-party USD / million tokens, checked against official pricing.
// https://platform.claude.com/docs/en/about-claude/pricing
function rates(model: string, inputTokens = 0) {
  if (model === 'claude-sonnet-5-5') return { input: 2, output: 10, cacheRead: 0.1 };
  if (model === 'claude-haiku-5-5') return inputTokens > 100_000
    ? { input: 0.5, output: 2.5, cacheRead: 0.05 }
    : { input: 0.1, output: 0.5, cacheRead: 0.01 };
  throw new Error('Unsupported Anthropic model pricing; configure a supported ANTHROPIC_MODEL');
}
const tokens = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new ModelFailure('envelope', 'Missing or invalid Anthropic usage: cannot audit cost');
  return value;
};

export async function completeAnthropic(options: {
  http: typeof fetch; apiKey: string; model: string; signal: AbortSignal;
  system: string; input: string | AnthropicContent[];
  /** Latency-bound callers (live voice) lower these; defaults keep existing tasks unchanged. */
  maxTokens?: number; effort?: 'low' | 'medium' | 'high';
}) {
  rates(options.model); // Fail before spending if the configured model cannot be priced.
  let response: Response;
  try { response = await options.http('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: options.signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': options.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: options.model, max_tokens: options.maxTokens ?? 4096, system: options.system,
      output_config: { effort: options.effort ?? 'high' },
      messages: [{ role: 'user', content: options.input }],
    }),
  });
  } catch (error) {
    if (options.signal.aborted && options.signal.reason?.name !== 'TimeoutError') throw error;
    throw new ModelFailure(options.signal.reason?.name === 'TimeoutError' ? 'timeout' : 'transport', 'Anthropic request transport failed');
  }
  // Never surface the response body: provider errors may contain private input.
  if (!response.ok) throw new ModelFailure('http', `Anthropic request failed: HTTP ${response.status}`, response.status);
  let body: AnthropicMessage;
  try { body = await response.json() as AnthropicMessage; }
  catch (error) {
    if (options.signal.aborted && options.signal.reason?.name !== 'TimeoutError') throw error;
    throw new ModelFailure(options.signal.reason?.name === 'TimeoutError' ? 'timeout' : 'envelope', 'Invalid Anthropic response body');
  }
  const cost = anthropicCostUsd(body);
  // Even syntactically valid partial JSON must not pass on truncation/refusal/tool use.
  if (body.stop_reason !== 'end_turn') throw new ModelFailure('envelope', 'Anthropic response incomplete');
  if (!Array.isArray(body.content) || body.content.some(block => !block || typeof block !== 'object' || (block.type === 'text' && typeof block.text !== 'string'))) throw new ModelFailure('envelope', 'Invalid Anthropic content blocks');
  const content = body.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('');
  return { model: body.model, choices: [{ message: { content } }], usage: { prompt_tokens: body.usage.input_tokens, completion_tokens: body.usage.output_tokens, cost } };
}

/** Usage-based charge, including cache tokens, for evidence and audit metadata. */
export function anthropicCostUsd(body: Pick<AnthropicMessage, 'model' | 'usage'>): number {
  if (!body.usage) throw new ModelFailure('envelope', 'Missing or invalid Anthropic usage: cannot audit cost');
  const input = tokens(body.usage.input_tokens);
  const output = tokens(body.usage.output_tokens);
  const read = tokens(body.usage.cache_read_input_tokens ?? 0);
  const created = tokens(body.usage.cache_creation_input_tokens ?? 0);
  const hour = tokens(body.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const fiveMinute = tokens(body.usage.cache_creation?.ephemeral_5m_input_tokens ?? created);
  if (hour + fiveMinute !== created) throw new ModelFailure('envelope', 'Invalid Anthropic cache usage');
  const price = rates(body.model, input + read + created);
  return (input * price.input + output * price.output + read * price.cacheRead
    + fiveMinute * price.input * 1.25 + hour * price.input * 2) / 1_000_000;
}
