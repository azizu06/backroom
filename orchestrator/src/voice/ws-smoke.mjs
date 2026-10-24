// Phone-free T1 test using local synthetic speech, not a live microphone.
// Requires Node 24, macOS say, and ffmpeg. Does not dial the PSTN.
// https://docs.cartesia.ai/line/integrations/websocket-api
// https://docs.cartesia.ai/api-reference/auth/access-token
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { cartesia } from './t1.mjs';
if (process.env.VOICE_WS_GO !== 'yes') throw new Error('Opt in with VOICE_WS_GO=yes');
const state = JSON.parse(fs.readFileSync('.env.t1/resources.json'));
for (const [command, args] of [
  ['say', ['-o', '.env.t1/yes.aiff', 'Yes, this is Jordan. Please run the connectivity check.']],
  ['ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', '.env.t1/yes.aiff', '-ar', '16000', '-ac', '1', '-f', 's16le', '.env.t1/yes.pcm']],
]) {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  if (result.status !== 0) throw new Error(`Install/verify ${command} before the WebSocket smoke`);
}
const { token } = await cartesia('/access-token', { grants: { agent: true }, expires_in: 120 });
const ws = new WebSocket(`wss://api.cartesia.ai/v1/agents/websocket/${state.agent_id}?cartesia_version=2026-08-14&access_token=${encodeURIComponent(token)}`);
const events = []; let sent = false; let callId;
const timer = setTimeout(() => ws.close(1000, 'smoke deadline'), 55_000);
// Agent access tokens reject client-supplied dynamic variables in this account.
// The existing T1 agent needs none for its fixed greeting or echo tool.
ws.onopen = () => ws.send(JSON.stringify({ type: 'session_create', audio: { input_format: 'pcm_16000', output_delivery: 'speaking_pace' } }));
async function speak() {
  if (sent) return; sent = true;
  await new Promise(resolve => setTimeout(resolve, 1000));
  const pcm = fs.readFileSync('.env.t1/yes.pcm');
  for (let i = 0; i < pcm.length && ws.readyState === WebSocket.OPEN; i += 1600) {
    ws.send(JSON.stringify({ type: 'audio_input', audio: pcm.subarray(i, i + 1600).toString('base64') }));
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'audio_input', audio: Buffer.alloc(32000).toString('base64') }));
}
ws.onmessage = message => {
  const event = JSON.parse(message.data);
  if (event.type === 'session_ready') { callId = event.call_id; console.log('Phone-free session ready'); }
  if (event.type !== 'audio_output') events.push({ ...event, received_at: new Date().toISOString() });
  if (event.type === 'turn_ended' && event.role === 'assistant') void speak();
};
ws.onerror = () => { console.error('WebSocket transport error'); process.exitCode = 1; };
ws.onclose = () => {
  clearTimeout(timer);
  fs.writeFileSync('.env.t1/websocket-evidence.json', JSON.stringify({ callId, events }, null, 2), { mode: 0o600 });
  const success = events.some(event => event.tool_calls?.some(tool => tool.name === 't1_echo' && tool.result?.includes('"ok":true')));
  console.log(success ? 'Phone-free echo tool succeeded; private evidence saved.' : 'Phone-free echo tool unproven; inspect private evidence.');
  if (!success) process.exitCode = 1;
};
