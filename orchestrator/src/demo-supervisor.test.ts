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

async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_BIND_FAILED');
  const port = address.port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  // Never reuse a listener already owned by another worker.
  try { execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { stdio: 'ignore' }); }
  catch (error) { if ((error as { status?: number }).status === 1) return port; throw error; }
  throw new Error('TEST_PORT_IN_USE');
}

it('demo:up owns the attack child, routes the web proxy, reports mock health and stops it on down', async () => {
  const scratch = join(root, '.demo');
  mkdirSync(scratch, { recursive: true });
  const fixture = mkdtempSync(join(scratch, 'supervisor-test-'));
  const port = await freePort(), attackPort = await freePort();
  const env = { PATH: process.env.PATH, STATE_STORE: 'memory', DEMO_TUNNEL: '0', DEMO_PREBUILT: '1',
    DEMO_PORT: String(port), ATTACK_DEMO_PORT: String(attackPort), ATTACK_DEMO_BASE_URL: 'http://127.0.0.1:1' };
  cpSync(join(root, 'tools/demo'), join(fixture, 'tools/demo'), { recursive: true });
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
      if (req.url === '/api/attack-demo') {
        const response = await proxy(new Request(process.env.DEMO_PUBLIC_URL + req.url));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(await response.text()); return;
      }
      if (req.headers.authorization !== 'Bearer ' + process.env.DEMO_CONTROL_SECRET) { res.writeHead(401).end(); return; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ llmEnabled: false, stateStore: 'memory', voice: false, workersHealthy: true }));
    }).listen(Number(process.env.DEMO_PORT), '127.0.0.1');
  `);
  const cli = async (command: string) => (await run(process.execPath,
    ['--import', loader, join(fixture, 'tools/demo/cli.ts'), command], { cwd: fixture, env, timeout: 30000 })).stdout;
  try {
    const output = await cli('up');
    const response = await fetch(`http://127.0.0.1:${port}/api/attack-demo`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ defaultMode: 'mock', liveBlocked: true });
    expect(output).toContain(`Attack demo: http://127.0.0.1:${port}/attack`);
    expect(await cli('health')).toContain('Attack demo: reachable (mock)');
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
    rmSync(fixture, { recursive: true, force: true });
  }
}, 45000);
