import { spawn, execFileSync } from 'node:child_process';
import { createServer as httpServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { createRequire } from 'node:module';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync, appendFileSync, chmodSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { demoBindHost, externalState } from './host';
import { localSpacetime } from './spacetime';
import { OwnedProcesses } from './processes';
import { probeDependencies, type DemoStatus, type HealthRow } from './health';

const root = fileURLToPath(new URL('../../', import.meta.url));
process.chdir(root);
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const dir = join(root, '.demo');
const recordFile = join(dir, 'process.json'), lockFile = join(dir, 'owner.lock');
const loader = pathToFileURL(createRequire(join(root, 'orchestrator/package.json')).resolve('tsx')).href;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const command = process.argv[2];
interface Owner { port: number; token: string; pid: number }
const owner = (): Owner => JSON.parse(readFileSync(recordFile, 'utf8'));
async function control<T = DemoStatus & { publicUrl: string; localUrl: string }>(action: string) {
  const record = owner();
  const response = await fetch(`http://127.0.0.1:${record.port}/${action}`, { method: action === 'status' || action === 'health' ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${record.token}` }, signal: AbortSignal.timeout(action === 'reset' ? 130000 : action === 'health' ? 30000 : 10000) });
  if (!response.ok) throw new Error('DEMO_CONTROL_FAILED');
  return response.json() as Promise<T>;
}
function printUrls(status: DemoStatus & { publicUrl: string; localUrl: string }) {
  console.log(`Local office: ${status.localUrl}/office`);
  for (const [label, path] of Object.entries({ Office: '/office', 'Audit wall': '/audit', 'Inbox tray': '/inbox',
    'Policy editor': '/policy', Controller: '/controller', Approve: status.approvePath, Pay: status.payPath, 'Real vs simulated': '/real-vs-sim' })) {
    console.log(`${label}: ${status.publicUrl}${path || '/ (not seeded)'}`);
  }
  console.log(`StateStore=${status.stateStore}; ${status.bank}; synthetic preverified caller; LLM ${status.llmEnabled ? 'ON' : 'OFF'}. See docs/test-v1.md.`);
}
async function waitFor(check: () => Promise<boolean>, ms: number) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await check()) return; await delay(250); }
  throw new Error('DEMO_START_TIMEOUT');
}
async function available(port: number, host = '127.0.0.1') {
  await new Promise<void>((resolve, reject) => {
    const probe = netServer(); probe.once('error', () => reject(new Error('DEMO_PORT_IN_USE')));
    probe.listen(port, host, () => probe.close(() => resolve()));
  });
}
async function supervise() {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  closeSync(openSync(lockFile, 'wx', 0o600));
  const token = randomBytes(32).toString('hex');
  const env: NodeJS.ProcessEnv = { ...process.env, STATE_STORE: process.env.STATE_STORE || 'spacetime',
    BACKROOM_DEMO: '1', BACKROOM_APPROVAL_DEMO: '0', BACKROOM_PAYMENT_DEMO: '0', DEMO_CONTROL_SECRET: token };
  if (env.DEMO_LIVE === '1') {
    env.PRECALL_APIFY = 'live';
    env.PRECALL_CRS = env.CRS_USERNAME?.trim() && env.CRS_PASSWORD ? 'live' : 'fake'; env.VENDOR_CRS = env.PRECALL_CRS; env.LLM_CLOUD_PROVIDER = 'anthropic'; env.GX10_ENABLED = 'true';
  }
  const children = new OwnedProcesses(root, env);
  let stopping = false;
  let base = '', publicUrl = '';
  const database = localSpacetime(root, env, children);
  let remote: ReturnType<typeof externalState>;
  let bindHost = '127.0.0.1';
  let stateConfig: Awaited<ReturnType<typeof database.publish>> | undefined;
  let resetting = false;
  const queryWeb = async (action: string) => {
    const response = await fetch(`${base}/__demo/${action}`, { method: action === 'reset' ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(action === 'reset' ? { body: JSON.stringify(stateConfig || {}) } : {}), signal: AbortSignal.timeout(action === 'reset' ? 125000 : action === 'health' ? 28000 : 5000) });
    if (!response.ok) throw new Error('DEMO_WEB_UNAVAILABLE');
    return response.json() as Promise<DemoStatus>;
  };
  const server = httpServer(async (req, res) => {
    const actual = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { res.writeHead(401).end(); return; }
    try {
      if (req.url === '/down' && req.method === 'POST') { res.end('{}'); void stop(); return; }
      if (((req.url === '/status' || req.url === '/health') && req.method === 'GET') || (req.url === '/reset' && req.method === 'POST')) {
        if (req.url === '/reset') {
          if (remote) { res.writeHead(409).end(); return; }
          if (resetting) { res.writeHead(409).end(); return; }
          resetting = true;
          try { if (env.STATE_STORE === 'spacetime') stateConfig = await database.publish(); }
          catch { resetting = false; throw new Error('DEMO_PUBLISH_FAILED'); }
        }
        if (req.url === '/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await queryWeb('health'))); return; }
        let status: DemoStatus;
        try { status = await queryWeb(req.url === '/reset' ? 'reset' : 'status'); }
        finally { if (req.url === '/reset') resetting = false; }
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...status, publicUrl, localUrl: base, tunnelUrl: env.DEMO_TUNNEL === '0' ? undefined : publicUrl })); return;
      }
      res.writeHead(404).end();
    } catch { res.writeHead(503).end(); }
  });
  async function stop() {
    if (stopping) return; stopping = true;
    server.close(); await children.stop();
    for (const file of [recordFile, lockFile]) { try { unlinkSync(file); } catch { /* absent */ } }
    process.exit(0);
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { void stop(); });
  try {
    remote = externalState(env); bindHost = demoBindHost(env);
    if (!['memory', 'spacetime'].includes(env.STATE_STORE)) throw new Error('DEMO_INVALID_STATE_STORE');
    const port = Number(env.DEMO_PORT || 3000), voicePort = Number(env.VOICE_PORT || 8788);
    await available(port, bindHost); base = `http://${bindHost.includes(':') ? `[${bindHost}]` : bindHost}:${port}`;
    if (env.DEMO_VOICE === '1') await available(voicePort);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('DEMO_CONTROL_BIND');
    writeFileSync(recordFile, JSON.stringify({ port: address.port, token, pid: process.pid }), { mode: 0o600 });
    if (remote) {
      stateConfig = remote;
    } else if (env.STATE_STORE === 'spacetime') {
      await available(database.port, database.host); await database.start();
      await waitFor(async () => { try { return (await fetch(`${database.http}/v1/ping`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, 20000);
      stateConfig = await database.publish();
      env.SPACETIMEDB_URI = stateConfig.uri; env.SPACETIMEDB_DATABASE = stateConfig.database; env.SPACETIMEDB_TOKEN = stateConfig.token;
    }
    // Each owned process gets separate logs. Never forward provider output into shared status.
    const stateMode = env.STATE_STORE; env.STATE_STORE = 'memory';
    if (env.DEMO_PREBUILT !== '1') await children.run('pnpm', ['--filter', '@backroom/web', 'build'], join(dir, 'build.log'));
    env.STATE_STORE = stateMode;
    publicUrl = base;
    if (env.DEMO_TUNNEL !== '0') {
      const log = join(dir, 'tunnel.log'); writeFileSync(log, '', { mode: 0o600 });
      children.start('cloudflared', ['tunnel', '--url', base, '--no-autoupdate'], log);
      await waitFor(async () => {
        const match = readFileSync(log, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) publicUrl = match[0]; return !!match;
      }, 30000);
    }
    env.DEMO_PUBLIC_URL = publicUrl;
    env.WEBAUTHN_ORIGIN = publicUrl; env.WEBAUTHN_RP_ID = new URL(publicUrl).hostname;
    env.POLICY_EDITOR_ORIGIN = publicUrl;
    // Keep controls private and stable across resets; no generated value is printed.
    const privateEnv = join(dir, 'private.env');
    if (!existsSync(privateEnv)) writeFileSync(privateEnv, ['TOOL_GATEWAY_SECRET', 'CONTROLLER_ENROLLMENT_SECRET', 'POLICY_DEMO_PIN']
      .map(name => `${name}=${randomBytes(24).toString('hex')}`).join('\n') + '\n', { mode: 0o600 });
    const existing = { ...process.env }; process.loadEnvFile(privateEnv);
    for (const name of ['TOOL_GATEWAY_SECRET', 'CONTROLLER_ENROLLMENT_SECRET', 'POLICY_DEMO_PIN']) env[name] = existing[name] || process.env[name];
    if (env.DEMO_VOICE === '1') {
      const voicePrivate = join(dir, 'voice-private.env');
      const names = ['VOICE_TOOL_SECRET', 'VOICE_ADMIN_SECRET', 'CARTESIA_WEBHOOK_SECRET'];
      if (!existsSync(voicePrivate)) writeFileSync(voicePrivate, names.map(name => `${name}=${randomBytes(24).toString('hex')}`).join('\n') + '\n', { mode: 0o600 });
      const prior = { ...process.env }; process.loadEnvFile(voicePrivate);
      for (const name of names) env[name] = env[name] || prior[name] || process.env[name];
    }
    env.VOICE_PUBLIC_URL = `${publicUrl}/_cartesia`;
    writeFileSync(join(dir, 'voice.env'), `VOICE_PUBLIC_URL=${env.VOICE_PUBLIC_URL}\n`, { mode: 0o600 });
    if (env.DEMO_VOICE === '1') {
      if (env.DEMO_TUNNEL === '0') throw new Error('DEMO_VOICE_REQUIRES_TUNNEL');
      // Voice owns a separate file journal. Avoid opening an unused StateStore subscription
      // on import (which otherwise keeps the one-shot setup process alive forever).
      const webStateMode = env.STATE_STORE; env.STATE_STORE = 'memory';
      await children.run(process.execPath, ['--import', loader, 'orchestrator/src/voice/live.ts', 'setup'], join(dir, 'voice-setup.log'));
      children.start(process.execPath, ['--import', loader, 'orchestrator/src/voice/live.ts', 'serve'], join(dir, 'voice.log'));
      env.STATE_STORE = webStateMode;
      await waitFor(async () => { try { return (await fetch(`http://127.0.0.1:${voicePort}/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, 20000);
      env.DEMO_VOICE_RUNNING = '1';
    }
    children.start(process.execPath, ['--import', loader, 'web/demo-server.ts'], join(dir, 'web.log'));
    await waitFor(async () => { try { return !!await queryWeb('status'); } catch { return false; } }, 90000);
    console.log(`Ready. ${env.DEMO_LIVE === '1' ? 'Live sandbox services' : 'Mock bank'}; ${env.STATE_STORE} state. No call placed.`);
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('DEMO_') ? error.message : 'DEMO_START_FAILED';
    console.error(message); await stop();
  }
}
async function main() {
  if (command === '_supervise') { await supervise(); return; }
  if (command === 'up') {
    if (!existsSync(recordFile) && !existsSync(lockFile)) {
      if (process.env.DEMO_LIVE === '1' && !process.env.ANTHROPIC_API_KEY) {
        try {
          const key = execFileSync('security', ['find-generic-password', '-s', 'backroom-anthropic-key', '-w'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
          if (!key || /[\r\n]/.test(key)) throw new Error();
          appendFileSync(join(root, '.env.local'), `\nANTHROPIC_API_KEY=${key}\n`, { mode: 0o600 }); chmodSync(join(root, '.env.local'), 0o600);
          process.env.ANTHROPIC_API_KEY = key;
        } catch { throw new Error('DEMO_ANTHROPIC_KEY_REQUIRED: configure Keychain backroom-anthropic-key or .env.local'); }
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const log = openSync(join(dir, 'supervisor.log'), 'a', 0o600);
      const child = spawn(process.execPath, ['--import', loader, fileURLToPath(import.meta.url), '_supervise'], {
        cwd: root, env: process.env, detached: true, stdio: ['ignore', log, log],
      }); closeSync(log); child.unref();
      await waitFor(async () => {
        try { await control('status'); return true; } catch { if (child.exitCode !== null) throw new Error('DEMO_START_FAILED'); return false; }
      }, 180000);
    }
    const status = await control('status');
    if ((process.env.DEMO_LIVE === '1') !== (status.live === true)) throw new Error('DEMO_MODE_MISMATCH: stop this owned demo before changing DEMO_LIVE');
    printUrls(status); return;
  }
  if (command === 'down') {
    if (!existsSync(recordFile)) {
      if (existsSync(lockFile)) throw new Error('DEMO_STALE_LOCK');
      console.log('No owned demo is running.'); return;
    }
    await control('down'); await waitFor(async () => !existsSync(recordFile), 15000);
    console.log('Stopped only this demo’s child processes; sponsor state and voice stops retained.'); return;
  }
  if (command === 'reset') { printUrls(await control('reset')); return; }
  if (command === 'health') {
    const status = await control('status');
    const hostRows = process.argv.includes('--live') ? await control<HealthRow[]>('health') : undefined;
    const rows = await probeDependencies({ hostRows, env: { ...process.env, DEMO_PUBLIC_URL: status.publicUrl }, status, live: process.argv.includes('--live') });
    for (const row of rows) console.log(`${row.ok ? '\u001b[32mGREEN' : '\u001b[31mRED'}\u001b[0m ${row.name}: ${row.detail}`);
    return;
  }
  throw new Error('DEMO_USAGE: up|reset|down|health [--live]');
}
main().catch(error => {
  console.error(error instanceof Error && error.message.startsWith('DEMO_') ? error.message : 'Demo unavailable; inspect private .demo/*.log. No persisted PID was signalled.');
  process.exitCode = 1;
});
