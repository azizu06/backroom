import { expect, it, vi } from 'vitest';
import { managedConfig, provisionVoice, voiceTools } from './tools';

it('provisions all nine real gateway schemas with hidden IDs and nonce assignments', async () => {
  const bodies: { path: string; method?: string; body: Record<string, any> }[] = [];
  let n = 0;
  const http: typeof fetch = vi.fn(async (url, init) => {
    bodies.push({ path: String(url), method: init?.method, body: JSON.parse(String(init?.body)) });
    return Response.json({ id: `resource-${++n}` });
  });
  const resources = { tools: {} };
  await provisionVoice({ apiKey: 'test', relayOrigin: 'https://relay.test', toolSecret: 'relay-secret', eventSecret: 'event-secret', resources, save: async () => undefined, http });
  const tools = bodies.filter(b => b.path.endsWith('/tools'));
  expect(tools.map(t => t.body.name).sort()).toEqual(Object.keys(voiceTools).sort());
  for (const { body } of tools) {
    expect(body.api_schema.request_body_schema.properties.call_id).toEqual({ type: 'string', dynamic_variable: 'voice_session_id' });
    expect(body.api_schema.request_body_schema.properties.webhook_request_id.dynamic_variable).toBe('delivery_nonce');
    expect(body.api_schema.request_body_schema.required).not.toContain('call_id');
    expect(body.api_schema.request_body_schema.required).not.toContain('webhook_request_id');
    expect(body.assignments).toEqual([{ dynamic_variable: 'delivery_nonce', value_path: 'next_delivery_nonce' }]);
  }
  const config = managedConfig(['tool']);
  expect(config.initial_message).toContain('This call is recorded.');
  expect(config.instructions).toContain('No voice approval ever counts.');
});

it('updates existing tools without the create-only type field', async () => {
  const resources = { tools: Object.fromEntries(Object.keys(voiceTools).map(name => [name, `tool-${name}`])), webhookId: 'webhook', agentId: 'agent' };
  const http: typeof fetch = vi.fn(async (_url, init) => {
    if (String(_url).includes('/v1/agents/tools/')) expect(JSON.parse(String(init?.body))).not.toHaveProperty('type');
    return Response.json({});
  });
  await provisionVoice({ apiKey: 'test', relayOrigin: 'https://relay.test', toolSecret: 'tool', eventSecret: 'event', resources, save: async () => undefined, http });
});
