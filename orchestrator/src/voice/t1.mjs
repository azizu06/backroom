// T1 smoke only: no collections decisions or financial data are exposed here.
// https://docs.cartesia.ai/calhacks
// https://docs.cartesia.ai/agents/configuration
// https://docs.cartesia.ai/agents/webhook-tools
// https://docs.cartesia.ai/line/infrastructure/observability#webhooks
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const statePath = '.env.t1/resources.json';
const receiptPath = '.env.t1/receipts.jsonl';
export const welcome = 'Hi, this is an AI assistant calling on behalf of Northfield Studio about invoice 1042. This call is recorded. Am I speaking with Jordan?';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export async function cartesia(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch(`https://api.cartesia.ai${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${required('CARTESIA_API_KEY')}`,
      'Cartesia-Version': '2026-08-14',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  // Error payloads can contain request data. Keep them in gitignored local evidence.
  const text = await response.text();
  if (!response.ok) {
    // A dial error can echo the destination: do not persist that response body.
    writeFileSync('.env.t1/last-error.json', path === '/agents/calls' ? JSON.stringify({ status: response.status }) : text, { mode: 0o600 });
    throw new Error(`Cartesia ${method} ${path}: HTTP ${response.status}; see private evidence`);
  }
  return JSON.parse(text);
}

function equalSecret(actual, expected) {
  const a = Buffer.from(actual || '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function smokeServer(secret, record) {
  // Persist only event identifiers/timing, never destination numbers or speech.
  const seen = new Set();
  if (existsSync(receiptPath)) {
    for (const line of readFileSync(receiptPath, 'utf8').trim().split('\n').filter(Boolean)) {
      const item = JSON.parse(line);
      if (item.webhook_request_id) seen.add(item.webhook_request_id);
    }
  }
  return createServer(async (req, res) => {
    const reply = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true });
    if (req.method !== 'POST') return reply(405, { error: 'method' });
    const event = req.url === '/api/voice/cartesia';
    const echo = req.url === '/api/tools/t1_echo';
    if (!event && !echo) return reply(404, { error: 'route' });
    const auth = event ? req.headers['x-webhook-secret'] : req.headers.authorization?.replace(/^Bearer /, '');
    if (!equalSecret(auth, secret)) return reply(401, { error: 'unauthorized' });
    const started = performance.now();
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 65_536) return reply(413, { error: 'too_large' });
      }
      const body = JSON.parse(raw);
      if (echo) {
        record({ type: 't1_echo', received_at: new Date().toISOString(), server_ms: performance.now() - started });
        return reply(200, { ok: true, message: 'T1 tool round trip received. No invoice details are available in this smoke test.' });
      }
      if (typeof body.webhook_request_id !== 'string' || !body.webhook_request_id || typeof body.type !== 'string') {
        return reply(400, { error: 'invalid_event' });
      }
      if (seen.has(body.webhook_request_id)) return reply(200, { duplicate: true });
      record({ type: body.type, call_id: body.call_id, webhook_request_id: body.webhook_request_id, received_at: new Date().toISOString(), timestamp: body.timestamp });
      seen.add(body.webhook_request_id);
      return reply(200, { ok: true });
    } catch {
      return reply(400, { error: 'invalid_request' });
    }
  });
}

async function main() {
  const command = process.argv[2];
  const save = (state) => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
  if (command === 'serve') {
    const server = smokeServer(required('CARTESIA_WEBHOOK_SECRET'), (receipt) => appendFileSync(receiptPath, JSON.stringify(receipt) + '\n', { mode: 0o600 }));
    server.listen(Number(process.env.T1_PORT || 8787), '127.0.0.1', () => console.log('T1 receiver listening on localhost'));
  } else if (command === 'catalog') {
    const models = await cartesia('/v1/agents/models');
    const anthropic = models.data.filter((model) => model.provider === 'Anthropic').map(({ id }) => id);
    state.catalog = { at: new Date().toISOString(), http_status: 200, anthropic };
    save(state);
    console.log(JSON.stringify(state.catalog));
  } else if (command === 'setup') {
    const base = required('T1_PUBLIC_URL');
    if (!base.startsWith('https://')) throw new Error('T1_PUBLIC_URL must be HTTPS');
    const secret = required('CARTESIA_WEBHOOK_SECRET');
    const webhookConfig = { url: `${base}/api/voice/cartesia`, secret, display_name: 'Backroom T1' };
    if (state.webhook_id) await cartesia(`/agents/webhooks/${state.webhook_id}`, webhookConfig, 'PATCH');
    else {
      const webhook = await cartesia('/agents/webhooks', webhookConfig);
      state.webhook_id = webhook.id; save(state);
    }
    const toolConfig = {
      name: 't1_echo', description: 'Run this connectivity check after the caller confirms identity. It returns no invoice data.',
      pre_tool_speech: 'off', execution_mode: 'immediate', response_timeout_secs: 2,
      api_schema: { url: `${base}/api/tools/t1_echo`, method: 'POST',
        request_body_schema: { type: 'object', properties: { probe: { type: 'string', constant_value: 't1' } } },
        authentication: { mode: 'bearer', token: { type: 'secret', secret_value: secret } },
      },
    };
    if (state.tool_id) await cartesia(`/v1/agents/tools/${state.tool_id}`, toolConfig, 'PATCH');
    else {
      const tool = await cartesia('/v1/agents/tools', { type: 'webhook', ...toolConfig });
      state.tool_id = tool.id; save(state);
    }
    if (!state.agent_id) {
      const agent = await cartesia('/v1/agents', { name: 'Backroom T1 smoke', config: {
        initial_message: welcome,
        instructions: 'This is an authorized connectivity test with a consenting teammate. After the caller confirms they are Jordan, invoke t1_echo once and report its result. Never discuss an amount, payment, or actual debt. If they deny identity, opt out, or mention bankruptcy, say goodbye and end the call. Before ending provide the callback number {{callback_number}}. Do not invent a callback number.',
        model: { id: 'claude-haiku-5.5' }, language: { primary: 'en' }, timezone: 'America/Los_Angeles',
        audio: { output: { voice_id: 'e07c00bc-4134-4eae-9ea4-1a55fb45746b' } },
        turn: { inactivity_end_call_secs: 60, inactivity_check_in_secs: 8 },
        tools: [{ id: state.tool_id }], system_tools: { end_call: { pre_tool_speech: 'force' } },
      } });
      state.agent_id = agent.id; save(state);
    }
    await cartesia(`/agents/${state.agent_id}`, { webhook_id: state.webhook_id }, 'PATCH');
    state.public_url = base; save(state);
    console.log('T1 agent, echo tool, and event webhook configured; no call placed.');
  } else if (command === 'number') {
    // Number itself is free: https://docs.cartesia.ai/line/integrations/telephony/cartesia-numbers
    // Usage still costs $0.014/min telephony plus agent usage; dial remains a separate approval gate.
    if (!state.number_id) {
      const numbers = await cartesia('/agents/phone-numbers');
      const number = numbers.data[0] || await cartesia('/agents/phone-numbers/provision', { label: 'Backroom T1' });
      state.number_id = number.id;
      state.callback_number = number.phone_number || number.number;
      save(state);
    }
    console.log('T1 number configured; number kept in private local state.');
  } else if (command === 'dial') {
    // This command is deliberately opt-in. Firstmate must supply target + go.
    // https://docs.cartesia.ai/line/integrations/telephony/outbound-dialing
    if (process.env.T1_DIAL_GO !== 'yes') throw new Error('Firstmate target-and-go approval required (T1_DIAL_GO=yes)');
    const number = required('T1_DIAL_TO');
    if (!/^\+1\d{10}$/.test(number)) throw new Error('T1 requires a US E.164 destination');
    const consent = { number_reference: '.env.local:T1_DIAL_TO', source: required('T1_CONSENT_SOURCE'), text: required('T1_CONSENT_TEXT'), timestamp: required('T1_CONSENT_AT') };
    if (!Number.isFinite(Date.parse(consent.timestamp)) || Date.parse(consent.timestamp) > Date.now()) throw new Error('Invalid consent timestamp');
    if (process.env.T1_B2B_TEST !== 'yes') throw new Error('T1_B2B_TEST=yes required for the synthetic B2B scenario');
    const local = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
    const weekday = local.find((part) => part.type === 'weekday').value;
    const hour = Number(local.find((part) => part.type === 'hour').value);
    const inWindow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday) && hour >= 9 && hour < 18;
    const demoOverride = process.env.DEMO_OVERRIDE === 'true';
    if (!inWindow && !demoOverride) throw new Error('CALL_WINDOW: set DEMO_OVERRIDE=true for the consenting demo');
    if (!state.agent_id || !state.number_id || !state.callback_number) throw new Error('Run setup and number first');
    // Store consent before dialing; the destination itself stays only in .env.local.
    writeFileSync('.env.t1/consent.json', JSON.stringify(consent, null, 2), { mode: 0o600 });
    state.dial_requested_at = new Date().toISOString();
    save(state);
    appendFileSync(receiptPath, JSON.stringify({ type: 'CALL_PERMIT', received_at: state.dial_requested_at, demo_override: demoOverride }) + '\n', { mode: 0o600 });
    const result = await cartesia('/agents/calls', {
      from_number_id: state.number_id, agent_id: state.agent_id, ringing_timeout_seconds: 60,
      outbound_calls: [{ to_number: number, dynamic_variables: { callback_number: state.callback_number } }],
    });
    // A 200 can still carry a per-destination failure. Never retry an ambiguous dial automatically.
    const call = result.calls?.[0];
    writeFileSync('.env.t1/dial-result.json', JSON.stringify({ accepted: Boolean(call?.agent_call_id && !call.error), call_id: call?.agent_call_id }), { mode: 0o600 });
    if (!call?.agent_call_id || call.error) throw new Error('Dial rejected; see private dial-result.json. No automatic retry.');
    state.call_id = call.agent_call_id; save(state);
    console.log('Dial accepted. Await actual ring confirmation and Cartesia call_turn; no automatic retry.');
  } else {
    throw new Error('Usage: node --env-file=.env.local orchestrator/src/voice/t1.mjs serve|catalog|setup|number|dial');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
