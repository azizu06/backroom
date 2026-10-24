// Opt-in local demo; no dialing occurs on import, setup, or serve.
import { createServer } from 'node:http';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createDemoVoiceBridge } from './demo-bridge';
import { dialCollectionCall, type DialInput } from './index';
import { provisionVoice, type VoiceTool } from './tools';
import { createVoiceHandler, VoiceJournal } from './server';

import { withVoiceEvidence } from './evidence';

const required = (name: string) => { const v = process.env[name]; if (!v) throw new Error(`Missing ${name}`); return v; };
const root = '.env.voice';
mkdirSync(root, { recursive: true, mode: 0o700 });
const resourceFile = `${root}/resources.json`;
const resources: { tools: Partial<Record<VoiceTool, string>>; webhookId?: string; agentId?: string } = existsSync(resourceFile) ? JSON.parse(readFileSync(resourceFile, 'utf8')) : { tools: {} };
const port = Number(process.env.VOICE_PORT || 8788);
const command = process.argv[2];
if (command === 'setup') {
  await provisionVoice({ apiKey: required('CARTESIA_API_KEY'), relayOrigin: required('VOICE_PUBLIC_URL'), toolSecret: required('VOICE_TOOL_SECRET'), eventSecret: required('CARTESIA_WEBHOOK_SECRET'), resources,
    save: async () => { writeFileSync(resourceFile, JSON.stringify(resources), { mode: 0o600 }); } });
  console.log('M4 agent and nine tools configured; no call placed.');
} else if (command === 'dial') {
  if (process.env.VOICE_DIAL_GO !== 'yes') throw new Error('Fresh explicit dial go required: VOICE_DIAL_GO=yes');
  const r = await fetch(`http://127.0.0.1:${port}/_admin/dial`, { method: 'POST', headers: { authorization: `Bearer ${required('VOICE_ADMIN_SECRET')}` } });
  if (!r.ok) throw new Error(`Local dial HTTP ${r.status}; inspect private audit`);
  console.log('Dial accepted; watch private call events. No automatic retry.');
} else if (command === 'serve') {
  if (!resources.agentId) throw new Error('Run setup before serve');
  const journal = new VoiceJournal(`${root}/journal.json`);
  const bridge = createDemoVoiceBridge({ port: Number(process.env.DEMO_PORT || 3000),
    controlSecret: required('DEMO_CONTROL_SECRET'), publicOrigin: required('DEMO_PUBLIC_URL') });
  const gatewaySecret = required('TOOL_GATEWAY_SECRET');
  const gateway = bridge.gateway;
  const handler = createVoiceHandler({ journal, gateway, gatewaySecret, toolSecret: required('VOICE_TOOL_SECRET'), eventSecret: required('CARTESIA_WEBHOOK_SECRET'), agentId: resources.agentId });
  const adminDigest = createHash('sha256').update(`Bearer ${required('VOICE_ADMIN_SECRET')}`).digest();
  createServer(withVoiceEvidence(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') { res.end('ok'); return; }
      if (req.method === 'POST' && req.url === '/_admin/dial') {
        if (!timingSafeEqual(createHash('sha256').update(req.headers.authorization || '').digest(), adminDigest)) { res.writeHead(401).end(); return; }
        if (await bridge.clientStopped()) { res.writeHead(409).end('CLIENT_STOPPED'); return; }
        const t1 = JSON.parse(readFileSync('.env.t1/resources.json', 'utf8')) as { number_id: string; callback_number: string };
        const number = required('T1_DIAL_TO');
        const demo = process.env.DEMO_OVERRIDE === 'true';
        if (demo) console.log('DEMO_OVERRIDE visible: consenting demo outside normal calling hours; permit audit persisted.');
        const input: DialInput = { sessionId: randomUUID(), agentId: resources.agentId!, fromNumberId: t1.number_id,
          clientId: 'northfield-jordan', invoiceId: '1042', businessName: 'Northfield Studio', contactName: 'Jordan', callbackNumber: t1.callback_number,
          client: { type: 'business', number, timeZone: 'America/Los_Angeles', dnc: false,
            consent: { number, source: required('T1_CONSENT_SOURCE'), text: required('T1_CONSENT_TEXT'), timestamp: required('T1_CONSENT_AT') } },
          demoOverride: demo ? { visible: true } : undefined };
        const result = await dialCollectionCall(input, { apiKey: required('CARTESIA_API_KEY'), allowDemoOverride: demo,
          audit: async entry => { appendFileSync(`${root}/audit.jsonl`, JSON.stringify(entry) + '\n', { mode: 0o600 }); },
          prepare: async (session, trusted) => {
            // Synthetic demo invoice; amounts go ONLY into the identity-gated server store.
            await bridge.register(session.id);
            await journal.register(session);
            writeFileSync(`${root}/consent-${session.id}.json`, JSON.stringify({ ...trusted.client.consent, number: undefined, number_reference: '.env.local:T1_DIAL_TO' }), { mode: 0o600 });
          } });
        await journal.bind(result.sessionId, result.callId);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result)); return;
      }
      let raw = Buffer.alloc(0);
      for await (const chunk of req) { raw = Buffer.concat([raw, chunk]); if (raw.length > 65_536) { res.writeHead(413).end(); return; } }
      const headers = new Headers();
      for (const name of ['authorization', 'x-webhook-secret', 'content-type']) { const v = req.headers[name]; if (typeof v === 'string') headers.set(name, v); }
      const result = await handler(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers,
        ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: raw } : {}) }));
      res.writeHead(result.status, Object.fromEntries(result.headers)); res.end(await result.text());
    } catch { res.writeHead(503).end('VOICE_UNAVAILABLE'); }
  }, line => appendFileSync(`${root}/http-evidence.jsonl`, line + '\n', { mode: 0o600 }))).listen(port, '127.0.0.1', () => console.log(`M4 local synthetic demo listening on ${port}. No call placed.`));
} else throw new Error('Usage: tsx src/voice/live.ts setup|serve|dial');
