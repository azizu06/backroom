import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { preflight } from './preflight';
import type { DemoStatus } from '../../../tools/demo/health';

const root = new URL('../../../', import.meta.url);
const envFile = new URL('.env.local', root);
if (existsSync(envFile)) process.loadEnvFile(fileURLToPath(envFile));
let status: DemoStatus | undefined;
try {
  const owner = JSON.parse(readFileSync(new URL('.demo/process.json', root), 'utf8')) as { port: number; token: string };
  const response = await fetch(`http://127.0.0.1:${owner.port}/status`, {
    headers: { authorization: `Bearer ${owner.token}` }, signal: AbortSignal.timeout(5000), redirect: 'error',
  });
  if (response.ok) {
    const body = await response.json() as DemoStatus & { localUrl: string };
    status = body;
    // Probe the running host's web port rather than a different shell's default.
    const local = new URL(body.localUrl);
    process.env.DEMO_PORT = local.port;
    process.env.DEMO_BIND_HOST = local.hostname;
  }
} catch { /* Still print every dependency when the host is down. */ }
const rows = await preflight(process.env, status);
for (const row of rows) console.log(`${row.ok ? '\u001b[32mGREEN' : '\u001b[31mRED'}\u001b[0m ${row.name}: ${row.detail}`);
if (rows.some(row => !row.ok)) process.exitCode = 1;
