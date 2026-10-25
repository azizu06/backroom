#!/usr/bin/env node
// Run from the built, isolated checkout: node tools/judge-check.mjs --live-origin https://your-demo-origin
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const states = ['verified', 'simulated', 'unreachable', 'unverified', 'disabled'];

export function liveOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTPS origin without a path, query or credentials');
  }
  return url.origin;
}

export const probes = [
  { name: 'Live status', path: '/api/demo-status', check(value) {
    if (!object(value) || typeof value.llmEnabled !== 'boolean' || !Number.isFinite(Date.parse(value.measuredAt))
      || !object(value.services)) throw new Error('Invalid demo-status shape');
    const entries = Object.entries(value.services);
    if (!entries.length) throw new Error('No service evidence available yet');
    for (const [id, probe] of entries) {
      if (!object(probe) || !states.includes(probe.state)) throw new Error('Invalid service state');
      if (probe.state === 'unreachable') throw new Error(`Service unavailable: ${id}`);
    }
    return `${entries.map(([id, probe]) => `${id}=${probe.state}`).join(', ')}; model ${value.llmEnabled ? 'ON' : 'OFF'}`;
  } },
  { name: 'Dana enrolled', path: '/api/controller/view', check(value) {
    if (!object(value) || value.registered !== true || typeof value.signedIn !== 'boolean') {
      throw new Error('Controller is not registered or response shape is invalid');
    }
    return 'Passkey registered; no sign-in or approval attempted';
  } },
  { name: 'Payment shape', path: '/api/pay/active', check(value) {
    if (!object(value) || !Object.hasOwn(value, 'active')) throw new Error('Invalid payment response');
    if (value.active === null) return 'Idle: no active payment link';
    const link = value.active;
    if (!object(link) || !/^[A-F0-9]{10}$/.test(link.code) || !Number.isSafeInteger(link.amountCents)
      || link.amountCents <= 0 || !Number.isFinite(link.expiresAt) || link.expiresAt <= Date.now()
      || typeof link.url !== 'string' || typeof link.qr !== 'string' || !link.qr.startsWith('data:image/png;base64,')) {
      throw new Error('Invalid or expired active payment link');
    }
    const url = new URL(link.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || url.pathname !== `/p/${link.code}`) throw new Error('Invalid public payment URL');
    return 'Active link shape valid; no link opened or payment attempted';
  } },
];

export async function probeLive(origin, fetcher = fetch) {
  return Promise.all(probes.map(async probe => {
    try {
      const response = await fetcher(`${liveOrigin(origin)}${probe.path}`, {
        method: 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10_000),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Expected JSON');
      return { check: probe.name, status: 'PASS', detail: probe.check(await response.json()) };
    } catch (error) {
      // Response bodies, links, credentials and provider evidence are deliberately not printed.
      const known = /^(HTTP \d+|Expected JSON|Invalid |No service|Controller |Service unavailable:)/.test(error.message);
      return { check: probe.name, status: 'FAIL', detail: known ? error.message : 'Probe failed or timed out' };
    }
  }));
}

async function localProof() {
  const web = join(root, 'web');
  if (!existsSync(join(web, '.next', 'BUILD_ID'))) return { check: 'Local judge path', status: 'FAIL', detail: 'Production build missing; run pnpm -r build on the owned build host first' };
  if (['.env', '.env.local', '.env.production', '.env.production.local'].some(file => existsSync(join(web, file)))) {
    return { check: 'Local judge path', status: 'FAIL', detail: 'Use an isolated checkout without web/.env files' };
  }
  const output = mkdtempSync(join(tmpdir(), 'backroom-judge-check-'));
  const log = join(output, 'judge-path.log');
  const fd = openSync(log, 'w');
  // Keep OS/runtime paths, but do not inherit the live host's provider keys or demo configuration.
  const env = { CI: '1', NEXT_TELEMETRY_DISABLED: '1' };
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'HOME', 'USERPROFILE', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const args = ['--filter', '@backroom/web', 'exec', 'playwright', 'test', '--config', 'tests/judge-path.config.ts', '--output', join(output, 'artifacts')];
  try {
    const code = await new Promise((done, reject) => {
      // Windows resolves the fixed pnpm.cmd launcher through cmd; no user argument enters this shell.
      const child = process.platform === 'win32'
        ? spawn('pnpm.cmd', [...args.slice(0, -1), `"${args.at(-1)}"`], { cwd: root, env, shell: true, stdio: ['ignore', fd, fd] })
        : spawn('pnpm', args, { cwd: root, env, stdio: ['ignore', fd, fd] });
      child.once('error', reject); child.once('exit', done);
    });
    return { check: 'Local judge path', status: code === 0 ? 'PASS' : 'FAIL', detail: `Exit ${code}; evidence ${log}` };
  } catch {
    return { check: 'Local judge path', status: 'FAIL', detail: `Could not start pnpm; evidence ${log}` };
  } finally { closeSync(fd); }
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('node tools/judge-check.mjs --live-origin https://your-demo-origin\nRequires a production build, installed Chromium, free local ports 3049/3050. Live probes are GET-only.');
    return 0;
  }
  if (args.length && (args.length !== 2 || args[0] !== '--live-origin')) throw new Error('Expected --live-origin https://your-demo-origin');
  const origin = liveOrigin(args[1] || process.env.JUDGE_LIVE_ORIGIN || '');
  const [local, live] = await Promise.all([localProof(), probeLive(origin)]);
  const rows = [local, ...live];
  console.table(rows);
  console.log('Live checks read configuration/evidence only; they do not prove a phone call or bank service will complete.');
  return rows.every(row => row.status === 'PASS') ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
