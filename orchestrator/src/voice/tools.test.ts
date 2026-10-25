import { expect, it, vi } from 'vitest';
import { managedConfig, provisionVoice, voiceTools, webhookTool } from './tools';

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
  expect(config.instructions).toContain('approval_status expired or pending_owner and may_reask true');
  expect(config.instructions).toContain('call propose_plan again immediately');
  expect(config.instructions).toContain('Do not say Dana will confirm by email while this call is open.');
  expect(voiceTools.check_approval.description).toContain('may_reask true');
  expect(voiceTools.check_approval.description).toContain('call propose_plan again immediately');
});

it('updates existing tools without the create-only type field', async () => {
  const resources = { tools: Object.fromEntries(Object.keys(voiceTools).map(name => [name, `tool-${name}`])), webhookId: 'webhook', agentId: 'agent' };
  const http: typeof fetch = vi.fn(async (_url, init) => {
    if (String(_url).includes('/v1/agents/tools/')) expect(JSON.parse(String(init?.body))).not.toHaveProperty('type');
    return Response.json({});
  });
  await provisionVoice({ apiKey: 'test', relayOrigin: 'https://relay.test', toolSecret: 'tool', eventSecret: 'event', resources, save: async () => undefined, http });
});

it('gives webhook tools a deadline the venue tunnel can meet and bounds identity re-asks', () => {
  for (const name of Object.keys(voiceTools) as (keyof typeof voiceTools)[]) {
    expect(webhookTool(name, 'https://relay.test', 'secret').response_timeout_secs).toBeGreaterThanOrEqual(8);
  }
  const config = managedConfig(['tool']);
  expect(config.audio.input.noise_suppression).toBe('max');
  expect(config.instructions).toContain('If next_step is ask_again_once, rephrase the question once');
  expect(config.instructions).toContain('If next_step is offer_callback_and_end');
  expect(config.instructions).toContain('Never ask the identity question more than twice.');
  expect(config.instructions).toContain('call that same tool once more right away');
  expect(config.instructions).toContain('Never ask the caller to repeat an answer because of a system error.');
});

it('requires the agent to submit requested terms before verbal policy decisions', () => {
  const instructions = managedConfig(['proposal-tool']).instructions;
  expect(instructions).toContain('Before offering, refusing, or negotiating any payment terms, call propose_plan and wait for its result.');
  expect(instructions).toContain('Submit the caller\'s requested terms even when they exceed the envelope, including four installments or a fee waiver.');
  expect(instructions).toContain('If a number is ambiguous (for example "for" versus "four"), ask for clarification before choosing installments.');
});
