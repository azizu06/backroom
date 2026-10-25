import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY } from '@backroom/policy';
import { createRouter } from '../router';
import { MemoryStateStore } from '../store';
import { createCallPlanner } from './planner';

const input = { envelope: { ...DEFAULT_POLICY.badges.collections.limits, payInFull: true as const }, preferPlanFirst: false, healthCheckPending: false };
const output = { tone: 'neutral', offerOrder: ['pay_in_full'], plan: { installments: 1, firstPaymentPct: 100, totalDays: 0, waiveFees: false, discountPct: 0 } };
const response = () => Response.json({ choices: [{ message: { content: JSON.stringify({ output, confidence: 0.99 }) } }], usage: { prompt_tokens: 50, completion_tokens: 50 } });

describe('routed pre-call planner', () => {
  it('returns LLM_OFF with no model call or fallback when the global store is off', async () => {
    const store = new MemoryStateStore();
    await store.setLlmEnabled(false);
    const http = vi.fn<typeof fetch>();
    const cloud = createRouter({ stateStore: store, fetch: http, cloudProvider: 'openrouter', cloudApiKey: 'test' });
    const fallbackRoute = vi.fn();
    expect(await createCallPlanner({ cloudRoute: cloud.route, fallbackRoute }).draft(input)).toMatchObject({ kind: 'LLM_OFF', route: 'code' });
    expect(http).not.toHaveBeenCalled();
    expect(fallbackRoute).not.toHaveBeenCalled();
  });
  it('configures low reasoning and the router wrapper on the production GX10 fallback transport', async () => {
    const cloud = createRouter({ fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 402 })), cloudProvider: 'openrouter', cloudApiKey: 'test' });
    const http = vi.fn<typeof fetch>().mockResolvedValue(response());
    expect(await createCallPlanner({ cloudRoute: cloud.route, fallbackFetch: http }).draft(input)).toMatchObject({ route: 'gx10_fallback' });
    const body = JSON.parse(String(http.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({ model: 'gpt-oss:120b', reasoning_effort: 'low' });
    expect(body.messages[0].content).toContain('top-level');
  });
  it.each([401, 429, 500])('does not downgrade HTTP %s errors to a local quality route', async status => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }));
    const cloud = createRouter({ fetch: http, cloudProvider: 'openrouter', cloudApiKey: 'test' });
    const fallbackRoute = vi.fn();
    await expect(createCallPlanner({ cloudRoute: cloud.route, fallbackRoute, reportFailure: vi.fn() }).draft(input)).rejects.toThrow('Call planner unavailable');
    expect(fallbackRoute).not.toHaveBeenCalled();
  });

  it('reports only a sanitized provider cause while keeping the public error generic', async () => {
    const cloud = createRouter({ fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response('private provider payload', { status: 401 })),
      cloudProvider: 'anthropic', anthropicApiKey: 'private-key', anthropicModel: 'claude-haiku-5-5' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const planner = createCallPlanner({ cloudRoute: cloud.route, modelId: 'claude-haiku-5-5' });
      await expect(planner.draft(input)).rejects.toThrow('Call planner unavailable');
      expect(log).toHaveBeenCalledWith('call planner unavailable', { stage: 'cloud', status: 401,
        errorType: 'ModelFailure', code: 'http', modelId: 'claude-haiku-5-5' });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private provider payload|private-key/);
    } finally { log.mockRestore(); }
  });

  it('keeps a successful Claude result on cloud and returns safe failure when both providers fail', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response('', { status: 402 }));
    const cloud = createRouter({ fetch: http, cloudProvider: 'openrouter', cloudApiKey: 'test' });
    const fallbackRoute = vi.fn(async () => { throw new Error('private transport payload'); });
    const planner = createCallPlanner({ cloudRoute: cloud.route, fallbackRoute, reportFailure: vi.fn() });
    expect(await planner.draft(input)).toMatchObject({ output, route: 'cloud', model: 'anthropic/claude-sonnet-4.5' });
    await expect(planner.draft(input)).rejects.toThrow('Call planner unavailable');
  });
  it('uses the cloud call_plan route and falls back to gpt-oss:120b only on HTTP 402', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 402 })).mockResolvedValueOnce(response());
    const cloud = createRouter({ fetch: http, cloudProvider: 'openrouter', cloudApiKey: 'test', cloudBaseUrl: 'https://openrouter.example/v1' });
    const fallback = createRouter({ fetch: http, cloudProvider: 'openrouter', cloudApiKey: 'ollama', cloudBaseUrl: 'http://gx10.example/v1', cloudModel: 'gpt-oss:120b', cloudInputUsdPerMillion: 0, cloudOutputUsdPerMillion: 0 });
    const result = await createCallPlanner({ cloudRoute: cloud.route, fallbackRoute: fallback.route }).draft(input);
    expect(result).toMatchObject({ output, route: 'gx10_fallback', model: 'gpt-oss:120b', costUsd: 0 });
    expect(http.mock.calls.map(call => call[0])).toEqual(['https://openrouter.example/v1/chat/completions', 'http://gx10.example/v1/chat/completions']);
    expect(JSON.parse(String(http.mock.calls[0]![1]!.body)).model).toBe('anthropic/claude-sonnet-4.5');
    expect(JSON.parse(String(http.mock.calls[1]![1]!.body)).model).toBe('gpt-oss:120b');
  });
});
