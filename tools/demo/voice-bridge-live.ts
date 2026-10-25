/** Opt-in, no-dial synthetic context-read smoke. Records one gateway delivery; no provider request. */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

async function main() {
  if (!process.argv.includes('--confirm-owned-demo')) throw new Error('CONFIRM_OWNED_DEMO_REQUIRED');
  const root = process.env.BACKROOM_ROOT || fileURLToPath(new URL('../../', import.meta.url)); process.chdir(root);
  const { createDemoVoiceBridge } = await import(pathToFileURL(join(root, 'orchestrator/src/voice/demo-bridge.ts')).href);
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
  const invocation = { call_id: 'demo-collections-1042', webhook_request_id: randomUUID() };
  const toolResponse = await bridge.gateway('get_invoice_context', new Request('https://probe.invalid/api/tools/get_invoice_context', {
    method: 'POST', headers: { authorization: `Bearer ${process.env.TOOL_GATEWAY_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(invocation),
  }));
  const tool = await toolResponse.json();
  if (toolResponse.status !== 200 || tool.kind !== 'CONTEXT' || tool.invoice_id !== '1042') throw new Error('VOICE_BRIDGE_GATEWAY_FAILED');
  const callback = await fetch(`${status.publicUrl}/api/voice/tools/get_invoice_context`, {
    method: 'POST', headers: { authorization: `Bearer ${process.env.VOICE_TOOL_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...invocation, call_id: `health-unknown-${randomUUID()}` }), signal: AbortSignal.timeout(10000),
  });
  const callbackBody = await callback.json();
  if (callback.status !== 404 || callbackBody.error !== 'SESSION_NOT_FOUND') throw new Error('VOICE_CALLBACK_SESSION_GATE_FAILED');
  const proof = { measuredAt: new Date().toISOString(), bindHost: new URL(status.localUrl).hostname,
    privateVoiceClientStopped: 'authenticated boolean response over loopback', externalPrivateAdmin: new URL(status.localUrl).hostname === '127.0.0.1' ? 'not applicable (loopback-only bind)' : '403 on non-loopback socket', bridgeGateway: '200 CONTEXT (authorized; seeded synthetic invoice 1042 read)',
    publicVoiceToolCallback: '404 SESSION_NOT_FOUND (authorized; unknown synthetic session)',
    scope: 'Records one synthetic gateway delivery receipt. No registration, dial, provider request, approval/payment or live-call mutation. Both handler/auth gates exercised; this is not a live call receipt.' };
  writeFileSync('.demo/voice-bridge-live.json', JSON.stringify(proof, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(proof, null, 2));
}
main().catch(error => { console.error(error instanceof Error && /^(VOICE_|OWNED_|CONFIRM_)/.test(error.message) ? error.message : 'VOICE_BRIDGE_SMOKE_FAILED'); process.exitCode = 1; });
