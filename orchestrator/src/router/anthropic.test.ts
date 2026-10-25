import { afterEach, expect, it, vi } from 'vitest';
import { createRouter } from './index.js';

afterEach(() => vi.unstubAllEnvs());

it('prefers the direct Anthropic cloud transport and audits token cost', async () => {
  vi.stubEnv('LLM_CLOUD_PROVIDER', 'anthropic');
  vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-test');
  vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-test');
  const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
    model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: 'ignored' }, { type: 'text', text: '{"output":{"tone":"neutral"},"confidence":0.99}' }],
    usage: { input_tokens: 100, output_tokens: 20 },
  }));
  const result = await createRouter({ fetch: network }).route('call_plan', {}, {
    parse(value: unknown) { expect(value).toEqual({ tone: 'neutral' }); return value; },
  });
  expect(result).toMatchObject({ route: 'cloud', model: 'claude-sonnet-5-5', costUsd: 0.0004, output: { tone: 'neutral' } });
  expect(network).toHaveBeenCalledTimes(1);
  expect(network.mock.calls[0]?.[0]).toBe('https://api.anthropic.com/v1/messages');
  const init = network.mock.calls[0]![1]!;
  expect(init.headers).toMatchObject({ 'x-api-key': 'anthropic-test', 'anthropic-version': '2023-06-01' });
  expect(init.headers).not.toHaveProperty('Authorization');
  const body = JSON.parse(String(init.body));
  expect(body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 4096, messages: [{ role: 'user', content: '{}' }] });
  expect(body.system).toContain('Complete response JSON Schema:');
  expect(body).not.toHaveProperty('temperature');
  expect(body).not.toHaveProperty('response_format');
});

const message = (overrides: Record<string, unknown> = {}) => ({
  model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: '{"output":{"seat":"ap"},"confidence":0.99}' }],
  usage: { input_tokens: 100, output_tokens: 20 }, ...overrides,
});
const keyOptions = { cloudProvider: 'anthropic' as const, anthropicApiKey: 'anthropic-test', cloudApiKey: 'openrouter-test' };

it('keeps extraction local, then escalates two schema failures to real Claude', async () => {
  const network = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: 'broken' } }] }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"output":{},"confidence":1}' } }] }))
    .mockResolvedValueOnce(Response.json(message()));
  const result = await createRouter({ ...keyOptions, fetch: network }).route('field_extraction', {}, {
    parse(value: unknown) {
      if (!value || typeof value !== 'object' || !('seat' in value)) throw new Error('Missing seat');
      return value;
    },
  });
  expect(result).toMatchObject({ route: 'cloud_fallback', model: 'claude-sonnet-5-5', costUsd: 0.0004 });
  expect(network.mock.calls.map(([url]) => String(url))).toEqual([
    'http://100.117.44.20:11434/v1/chat/completions',
    'http://100.117.44.20:11434/v1/chat/completions',
    'https://api.anthropic.com/v1/messages',
  ]);
});

it('falls back to direct Anthropic when GX10 goes offline', async () => {
  const network = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(Response.json(message()));
  const router = createRouter({ ...keyOptions, fetch: network });
  expect(await router.route('post_call_summary', {})).toMatchObject({ route: 'cloud_fallback', model: 'claude-sonnet-5-5' });
  expect(router.health().localAvailable).toBe(false);
});

it.each([
  { model: 'claude-sonnet-5-5', usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 100 } }, cost: 0.00115 },
  { model: 'claude-haiku-5-5', usage: { input_tokens: 100, output_tokens: 20 }, cost: 0.00002 },
  { model: 'claude-haiku-5-5', usage: { input_tokens: 100001, output_tokens: 20 }, cost: 0.0500505 },
])('prices $model from all returned usage tokens', async ({ model, usage, cost }) => {
  const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(message({ model, usage })));
  const result = await createRouter({ ...keyOptions, anthropicModel: model, fetch: network }).route('call_plan', {});
  expect(result.costUsd).toBeCloseTo(cost, 10);
  expect(result.model).toBe(model);
});

it.each([
  { overrides: { usage: undefined }, error: 'usage' },
  { overrides: { usage: { input_tokens: -1, output_tokens: 20 } }, error: 'usage' },
  { overrides: { usage: { input_tokens: 100 } }, error: 'usage' },
  { overrides: { stop_reason: 'max_tokens' }, error: 'incomplete' },
  { overrides: { stop_reason: 'refusal' }, error: 'incomplete' },
  { overrides: { content: [{ type: 'text', text: '{"output":{},"confidence":0.1}' }] }, error: 'human review' },
  { overrides: { content: [{ type: 'text', text: '{"output":{}}' }] }, error: 'envelope' },
])('fails closed without OpenRouter failover: $error ($overrides)', async ({ overrides, error }) => {
  const network = vi.fn<typeof fetch>().mockResolvedValue(Response.json(message(overrides)));
  await expect(createRouter({ ...keyOptions, fetch: network }).route('call_plan', {})).rejects.toThrow(error);
  expect(network).toHaveBeenCalledTimes(1);
});

it('sanitizes HTTP errors and does not silently spend with a second provider', async () => {
  const network = vi.fn<typeof fetch>().mockResolvedValue(new Response('private provider body', { status: 429 }));
  await expect(createRouter({ ...keyOptions, fetch: network }).route('call_plan', {})).rejects.toThrow('Anthropic request failed: HTTP 429');
  expect(network).toHaveBeenCalledTimes(1);
});

it('rejects unpriced model overrides before making a billable request', async () => {
  const network = vi.fn<typeof fetch>();
  await expect(createRouter({ ...keyOptions, anthropicModel: 'unpriced', fetch: network }).route('call_plan', {})).rejects.toThrow('pricing');
  expect(network).not.toHaveBeenCalled();
});

it('fences direct Anthropic work on OFF and never retries it on OpenRouter', async () => {
  const { MemoryStateStore } = await import('../store.js');
  const state = new MemoryStateStore();
  let finish!: (response: Response) => void;
  const network = vi.fn<typeof fetch>().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const router = createRouter({ ...keyOptions, stateStore: state, fetch: network });
  await state.setLlmEnabled(false);
  expect(await router.route('call_plan', {})).toMatchObject({ kind: 'LLM_OFF', costUsd: 0 });
  expect(network).not.toHaveBeenCalled();
  await state.setLlmEnabled(true);
  const pending = router.route('ask_why', {});
  const signal = network.mock.calls[0]?.[1]?.signal;
  await state.setLlmEnabled(false);
  expect(signal?.aborted).toBe(true);
  await state.setLlmEnabled(true);
  finish(Response.json(message()));
  expect(await pending).toMatchObject({ kind: 'LLM_OFF' });
  expect(network).toHaveBeenCalledTimes(1);
});

it('keeps OpenRouter inactive when the primary Anthropic key is missing', async () => {
  vi.stubEnv('LLM_CLOUD_PROVIDER', 'anthropic');
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('OPENROUTER_API_KEY', 'unused');
  const network = vi.fn<typeof fetch>();
  await expect(createRouter({ fetch: network }).route('call_plan', {})).rejects.toThrow('ANTHROPIC_API_KEY is required');
  expect(network).not.toHaveBeenCalled();
});

it.each([
  { kind: 'http', response: () => new Response('private provider body', { status: 429 }), status: 429 },
  { kind: 'envelope', response: () => new Response('not JSON') },
  { kind: 'envelope', response: () => Response.json(message({ content: [{ type: 'text', text: '{"output":{},"confidence":1,"extra":true}' }] })) },
  { kind: 'schema', response: () => Response.json(message({ content: [{ type: 'text', text: '{"output":{},"confidence":1}' }] })) },
  { kind: 'confidence', response: () => Response.json(message({ content: [{ type: 'text', text: '{"output":{"seat":"ap"},"confidence":0.1}' }] })) },
])('preserves redacted $kind diagnostics across the Anthropic transport', async ({ kind, response, status }) => {
  const onFailure = vi.fn();
  const network = vi.fn<typeof fetch>().mockImplementation(async () => response());
  const router = createRouter({ ...keyOptions, fetch: network, onFailure });
  await expect(router.route('call_plan', {}, { parse(value: unknown) {
    if (!value || typeof value !== 'object' || !('seat' in value)) throw new Error('Missing seat');
    return value;
  } })).rejects.toThrow();
  expect(onFailure.mock.calls).toEqual([[{ taskType: 'call_plan', route: 'cloud', kind, ...(status && { status }) }]]);
  expect(network).toHaveBeenCalledTimes(1);
});

it.each(['timeout', 'transport'] as const)('classifies Anthropic %s failures without provider fallback', async kind => {
  const onFailure = vi.fn();
  const timeout = kind === 'timeout'
    ? AbortSignal.abort(new DOMException('Timed out', 'TimeoutError')) : new AbortController().signal;
  const timer = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout);
  try {
    const network = vi.fn<typeof fetch>().mockRejectedValue(new Error('private connection details'));
    await expect(createRouter({ ...keyOptions, fetch: network, onFailure }).route('call_plan', {})).rejects.toThrow('transport failed');
    expect(onFailure.mock.calls).toEqual([[{ taskType: 'call_plan', route: 'cloud', kind }]]);
    expect(network).toHaveBeenCalledTimes(1);
  } finally { timer.mockRestore(); }
});
