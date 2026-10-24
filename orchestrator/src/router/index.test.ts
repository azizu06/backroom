import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRouter, TASK_ROUTES } from './index.js';
const completion = (output: unknown = { seat: 'ap' }, confidence = 0.99, usage: unknown = {prompt_tokens:100,completion_tokens:20}) => Response.json({ choices:[{message:{content:JSON.stringify({output,confidence})}}],usage });
const schema = {parse(value: unknown) { if (!value || typeof value !== 'object' || !('seat' in value)) throw new Error('Missing seat'); return value as {seat:string}; }};
afterEach(() => vi.useRealTimers());
describe('router public boundary', () => {
  it('distinguishes initial availability from timestamped health evidence without a model call', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({data:[{id:'gpt-oss:20b'}]}));
    const router = createRouter({fetch:fetcher});
    expect(router.health().checkedAt).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    await router.healthPing();
    expect(router.health()).toMatchObject({localAvailable:true, checkedAt:expect.any(String)});
    expect(fetcher.mock.calls[0]?.[0]).toContain('/models');
  });
  it.each(['inbox_classification','field_extraction','reconciliation_candidates','post_call_summary'] as const)('routes %s locally with audit metadata', async task => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion());
    const router = createRouter({fetch:fetcher});
    expect(await router.route(task,{},schema)).toMatchObject({output:{seat:'ap'},route:'local',model:'gpt-oss:20b',costUsd:0,latencyMs:expect.any(Number)});
    expect(fetcher.mock.calls[0]?.[0]).toContain('100.117.44.20');
  });
  it.each(['call_plan','ask_why','ambiguous_judgment'] as const)('routes hard task %s directly to cloud',async task => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(completion());
    expect(await createRouter({fetch:fetcher,cloudApiKey:'test'}).route(task,{})).toMatchObject({route:'cloud',model:'anthropic/claude-sonnet-4.5',costUsd:0.0006});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('escalates after exactly two schema failures, including malformed JSON',async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({choices:[{message:{content:'broken'}}]})).mockResolvedValueOnce(completion({bad:true})).mockResolvedValueOnce(completion());
    const result = await createRouter({fetch:fetcher,cloudApiKey:'test'}).route('field_extraction',{},schema);
    expect(result.route).toBe('cloud_fallback');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('escalates low confidence immediately',async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(completion({},0.2)).mockResolvedValueOnce(completion());
    expect((await createRouter({fetch:fetcher,cloudApiKey:'test'}).route('field_extraction',{})).route).toBe('cloud_fallback');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('falls back within the same call on a broken link and stays offline',async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('ECONNREFUSED')).mockImplementation(async()=>completion());
    const router = createRouter({fetch:fetcher,cloudApiKey:'test'});
    expect((await router.route('post_call_summary',{})).route).toBe('cloud_fallback');
    expect((await router.route('post_call_summary',{})).route).toBe('cloud_fallback');
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(router.health().localAvailable).toBe(false);
  });
  it('disables local on HTTP failure and invalid model health response',async()=>{
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(completion()).mockResolvedValueOnce(Response.json({data:[]}));
    const router=createRouter({fetch:fetcher,cloudApiKey:'test'});
    expect((await router.route('field_extraction',{})).route).toBe('cloud_fallback');
    await router.healthPing();
    expect(router.health().healthyPings).toBe(0);
  });
  it('recovers only after three consecutive healthy pings, resetting on failure',async()=>{
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:500}));
    const router=createRouter({fetch:fetcher});
    await router.healthPing();
    fetcher.mockImplementation(async()=>Response.json({data:[{id:'gpt-oss:20b'}]}));
    await router.healthPing(); await router.healthPing();
    expect(router.health().localAvailable).toBe(false);
    fetcher.mockRejectedValueOnce(new Error('offline'));
    await router.healthPing(); await router.healthPing(); await router.healthPing();
    expect(router.health().localAvailable).toBe(false);
    await router.healthPing();
    expect(router.health().localAvailable).toBe(true);
  });
  it('falls back on the next call when rolling p50 exceeds 5s',async()=>{
    let time=0;
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>{time+=6000;return completion();});
    const router=createRouter({fetch:fetcher,cloudApiKey:'test',now:()=>time});
    await router.route('field_extraction',{});
    expect(router.health()).toMatchObject({localAvailable:false,p50LatencyMs:6000});
    expect((await router.route('field_extraction',{})).route).toBe('cloud_fallback');
  });
  it('polls at 10s and stops cleanly',async()=>{
    vi.useFakeTimers();
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({data:[{id:'gpt-oss:20b'}]}));
    const router=createRouter({fetch:fetcher}); router.start(); router.start();
    await vi.advanceTimersByTimeAsync(30000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    router.stop(); await vi.advanceTimersByTimeAsync(10000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('honors cloud-only mode and provider actual cost',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(completion({},0.9,{cost:0.001}));
    const router=createRouter({fetch:fetcher,cloudApiKey:'test',localEnabled:false});
    expect(await router.route('field_extraction',{})).toMatchObject({route:'cloud_fallback',costUsd:0.001});
    await router.healthPing(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('fails closed for invalid cloud schema, low confidence, missing cost and unsupported voice',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(completion({bad:true})).mockResolvedValueOnce(completion({},0.2)).mockResolvedValueOnce(completion({},0.9,{}));
    const router=createRouter({fetch:fetcher,cloudApiKey:'test'});
    await expect(router.route('ask_why',{},schema)).rejects.toThrow('Missing seat');
    await expect(router.route('ask_why',{})).rejects.toThrow('human review');
    await expect(router.route('ask_why',{})).rejects.toThrow('Missing cloud usage');
    await expect(router.route('in_call' as keyof typeof TASK_ROUTES,{})).rejects.toThrow('Cartesia');
  });
});

it('sends the complete response envelope schema, with the task schema nested under output', async () => {
  const planSchema = { type: 'object', required: ['tone'], properties: { tone: { const: 'neutral' } } };
  const network = vi.fn<typeof fetch>().mockResolvedValue(completion({ tone: 'neutral' }));
  await createRouter({ fetch: network, cloudApiKey: 'mock' }).route('call_plan', {}, { parse: value => value, jsonSchema: planSchema });
  const body = JSON.parse(String(network.mock.calls[0]?.[1]?.body));
  const marker = 'Complete response JSON Schema: ';
  const text: string = body.messages[0].content;
  expect(text).toContain(marker);
  const wireSchema = JSON.parse(text.split(marker)[1]!.split('\n')[0]!);
  expect(wireSchema).toMatchObject({ required: ['output', 'confidence'], properties: { output: planSchema, confidence: { type: 'number', minimum: 0, maximum: 1 } } });
});
