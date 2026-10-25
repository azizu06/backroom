import { expect, it } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const loader = createRequire(import.meta.url).resolve('tsx');
const run = promisify(execFile);
const requiredEnvNames = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'CRS_USERNAME', 'CRS_PASSWORD', 'NESSIE_API_KEY',
  'NESSIE_ACCOUNT_ID', 'CARTESIA_API_KEY', 'CARTESIA_WEBHOOK_SECRET', 'DEMO_PUBLIC_URL', 'APIFY_TOKEN', 'GX10_BASE_URL', 'GX10_MODEL'];

async function freePort(env: NodeJS.ProcessEnv = process.env) {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_BIND_FAILED');
  const port = address.port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  // Node's exclusive bind above is portable; also check lsof when installed on the host.
  try { execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { stdio: 'ignore', env }); }
  catch (error) {
    const failure = error as { status?: number; code?: string };
    if (failure.status === 1 || failure.code === 'ENOENT') return port;
    throw error;
  }
  throw new Error('TEST_PORT_IN_USE');
}

it.each(['memory', 'spacetime'])('demo:up owns an isolated mock attack child with %s web state, even without lsof', async stateStore => {
  const scratch = join(root, '.demo');
  mkdirSync(scratch, { recursive: true });
  const fixture = mkdtempSync(join(scratch, 'supervisor-test-'));
  const probeEnv = stateStore === 'spacetime' ? { PATH: '' } : process.env;
  const port = await freePort(probeEnv), attackPort = await freePort(probeEnv);
  const statePort = await freePort(probeEnv);
  let stateConnections = 0;
  // No real database: any TLS connection here is an unwanted mock-child subscription.
  const stateProbe = createServer(socket => { stateConnections++; socket.destroy(); });
  await new Promise<void>(resolve => stateProbe.listen(statePort, '127.0.0.1', resolve));
  const env = { PATH: process.env.PATH, STATE_STORE: stateStore, DEMO_LIVE: '1', DEMO_TUNNEL: '0', DEMO_PREBUILT: '1',
    ...(stateStore === 'spacetime' ? { DEMO_STATE_REMOTE: '1', SPACETIMEDB_URI: `wss://127.0.0.1:${statePort}`,
      SPACETIMEDB_DATABASE: 'synthetic-test', SPACETIMEDB_TOKEN: 'synthetic-token' } : {}),
    DEMO_PORT: String(port), ATTACK_DEMO_PORT: String(attackPort), ATTACK_DEMO_BASE_URL: 'http://127.0.0.1:1' };
  cpSync(join(root, 'tools/demo'), join(fixture, 'tools/demo'), { recursive: true });
  writeFileSync(join(fixture, '.env.local'), [
    ...requiredEnvNames.map(name => `${name}=${name === 'DEMO_PUBLIC_URL' ? 'https://demo.example.test' : name === 'GX10_BASE_URL' ? 'http://127.0.0.1:11434/v1' : `dummy-${name}`}`),
    'PRECALL_CRS=live', 'VENDOR_CRS=live',
  ].join('\n') + '\n');
  mkdirSync(join(fixture, 'orchestrator/src/attack-demo'), { recursive: true });
  cpSync(join(root, 'orchestrator/package.json'), join(fixture, 'orchestrator/package.json'));
  symlinkSync(join(root, 'orchestrator/node_modules'), join(fixture, 'orchestrator/node_modules'), 'dir');
  symlinkSync(join(root, 'orchestrator/src/demo-ops'), join(fixture, 'orchestrator/src/demo-ops'), 'dir');
  cpSync(join(root, 'orchestrator/src/attack-demo/server.ts'), join(fixture, 'orchestrator/src/attack-demo/server.ts'));
  symlinkSync(join(root, 'orchestrator/src/attack-demo/http.ts'), join(fixture, 'orchestrator/src/attack-demo/http.ts'));
  mkdirSync(join(fixture, 'web'));
  // Keep the web HTTP boundary small; exercise the real production attack proxy/server.
  writeFileSync(join(fixture, 'web/demo-server.ts'), `
    import { createServer } from 'node:http';
    import { createAttackDemoProxy } from ${JSON.stringify(pathToFileURL(join(root, 'web/lib/attack-demo/proxy.ts')).href)};
    const proxy = createAttackDemoProxy({ origin: () => process.env.DEMO_PUBLIC_URL,
      secret: () => process.env.TOOL_GATEWAY_SECRET, baseUrl: process.env.ATTACK_DEMO_BASE_URL,
      allowLive: () => process.env.ATTACK_DEMO_LIVE === '1' });
    createServer(async (req, res) => {
      if (req.url === '/env-names') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(${JSON.stringify(requiredEnvNames)}.filter(name => !!process.env[name]))); return;
      }
      if (req.url === '/api/attack-demo') {
        const response = await proxy(new Request(process.env.DEMO_PUBLIC_URL + req.url));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text()); return;
      }
      if (req.headers.authorization !== 'Bearer ' + process.env.DEMO_CONTROL_SECRET) { res.writeHead(401).end(); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ live: process.env.DEMO_LIVE === '1', llmEnabled: true, stateStore: process.env.STATE_STORE, voice: false, workersHealthy: true }));
    }).listen(Number(process.env.DEMO_PORT), '127.0.0.1');
  `);
  const cli = async (command: string) => (await run(process.execPath,
    ['--import', loader, join(fixture, 'tools/demo/cli.ts'), command], { cwd: fixture, env, timeout: 30000 })).stdout;
  try {
    const output = await cli('up');
    const response = await fetch(`http://127.0.0.1:${port}/api/attack-demo`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ defaultMode: 'mock', liveBlocked: true });
    expect(output).toContain(`Local office: http://127.0.0.1:${port}/office`);
    expect(output).toContain(`Inbox tray: http://localhost:${port}/inbox`);
    expect(output).toContain(`Attack demo: http://localhost:${port}/attack`);
    expect(output).toContain('Environment supervisor: ready');
    expect(output).toContain('Environment attack demo: ready');
    expect(output).toContain('Environment web + seats: ready');
    expect(await (await fetch(`http://127.0.0.1:${port}/env-names`)).json()).toEqual(requiredEnvNames);
    const health = await cli('health');
    expect(health).toContain('Attack demo: reachable (mock)');
    if (stateStore === 'spacetime') expect(health).toContain('SpacetimeDB: adapter connected');
    expect(stateConnections).toBe(0);
    expect((await fetch(`http://127.0.0.1:${attackPort}/api/attack-demo`)).status).toBe(401);
    await cli('down');
    await expect(fetch(`http://127.0.0.1:${attackPort}/api/attack-demo`)).rejects.toThrow();
    expect(existsSync(join(fixture, '.demo/process.json'))).toBe(false);
    const unrelated = createServer();
    await new Promise<void>(resolve => unrelated.listen(attackPort, '127.0.0.1', resolve));
    try {
      const refused = await run(process.execPath, ['--import', loader, join(fixture, 'tools/demo/cli.ts'), '_supervise'],
        { cwd: fixture, env, timeout: 10000 });
      expect(refused.stderr).toContain('DEMO_PORT_IN_USE');
      expect(unrelated.listening).toBe(true);
      expect(existsSync(join(fixture, '.demo/process.json'))).toBe(false);
    } finally { await new Promise<void>(resolve => unrelated.close(() => resolve())); }
  } finally {
    if (existsSync(join(fixture, '.demo/process.json'))) await cli('down');
    await new Promise<void>(resolve => stateProbe.close(() => resolve()));
    rmSync(fixture, { recursive: true, force: true });
  }
}, 45000);
