/** Opt-in, no-dial/read-only smoke for an already-running owned demo. No provider request. */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createDemoVoiceBridge } from '../../orchestrator/src/voice/demo-bridge';

async function main() {
  if (!process.argv.includes('--confirm-owned-demo')) throw new Error('CONFIRM_OWNED_DEMO_REQUIRED');
  const root = fileURLToPath(new URL('../../', import.meta.url)); process.chdir(root);
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  for (const file of ['.demo/private.env', '.demo/voice-private.env']) if (existsSync(file)) process.loadEnvFile(file);
  const owner = JSON.parse(readFileSync('.demo/process.json', 'utf8'));
  const statusResponse = await fetch(`http://127.0.0.1:${owner.port}/status`, { headers: { authorization: `Bearer ${owner.token}` }, signal: AbortSignal.timeout(10000) });
  if (!statusResponse.ok) throw new Error('OWNED_DEMO_UNAVAILABLE');
  const status = await statusResponse.json();
  const port = Number(new URL(status.localUrl).port);
  if (new URL(status.localUrl).hostname !== '127.0.0.1') {
    const externalAdmin = await fetch(`${status.localUrl}/__demo/voice-client-stopped`, { headers: { authorization: `Bearer ${owner.token}` }, signal: AbortSignal.timeout(5000) });
    if (externalAdmin.status !== 403) throw new Error('VOICE_PRIVATE_SOCKET_GUARD_FAILED');
    await externalAdmin.body?.cancel();
  }
  const bridge = createDemoVoiceBridge({ port, controlSecret: owner.token, publicOrigin: status.publicUrl });
  const stopped = await bridge.clientStopped();
  if (typeof stopped !== 'boolean') throw new Error('VOICE_ADMIN_RESPONSE_INVALID');
  const invocation = { call_id: `health-unknown-${randomUUID()}`, webhook_request_id: randomUUID() };
  const toolResponse = await bridge.gateway('get_invoice_context', new Request('https://probe.invalid/api/tools/get_invoice_context', {
    method: 'POST', headers: { authorization: `Bearer ${process.env.TOOL_GATEWAY_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(invocation),
  }));
  const tool = await toolResponse.json();
  if (toolResponse.status !== 404 || tool.error !== 'CALL_NOT_FOUND') throw new Error('VOICE_BRIDGE_GATEWAY_FAILED');
  const callback = await fetch(`${status.publicUrl}/api/voice/tools/get_invoice_context`, {
    method: 'POST', headers: { authorization: `Bearer ${process.env.VOICE_TOOL_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify(invocation), signal: AbortSignal.timeout(10000),
  });
  const callbackBody = await callback.json();
  if (callback.status !== 404 || callbackBody.error !== 'SESSION_NOT_FOUND') throw new Error('VOICE_CALLBACK_SESSION_GATE_FAILED');
  const proof = { measuredAt: new Date().toISOString(), bindHost: new URL(status.localUrl).hostname,
    privateVoiceClientStopped: 'authenticated boolean response over loopback', externalPrivateAdmin: '403 on non-loopback socket', bridgeGateway: '404 CALL_NOT_FOUND (authorized; unknown synthetic call)',
    publicVoiceToolCallback: '404 SESSION_NOT_FOUND (authorized; unknown synthetic session)',
    scope: 'No registration, dial, provider request, payment or existing call mutation. Both handler/auth gates exercised; this is not a live call receipt.' };
  writeFileSync('.demo/voice-bridge-live.json', JSON.stringify(proof, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(proof, null, 2));
}
main().catch(error => { console.error(error instanceof Error && /^(VOICE_|OWNED_|CONFIRM_)/.test(error.message) ? error.message : 'VOICE_BRIDGE_SMOKE_FAILED'); process.exitCode = 1; });
