import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { equalSecret } from './session';

export function operatorRoot() {
  const cwd = process.env.BACKROOM_ROOT || process.cwd();
  return existsSync(join(cwd, 'orchestrator/package.json')) ? cwd : resolve(cwd, '..');
}
/** Same private supervisor endpoints used by tools/demo/cli.ts. Never runs arbitrary commands or exposes the owner record. */
export async function demoControl(action: 'status' | 'health' | 'reset') {
  const owner = JSON.parse(await readFile(join(operatorRoot(), '.demo/process.json'), 'utf8')) as { port: number; token: string };
  if (!Number.isInteger(owner.port) || owner.port < 1 || owner.port > 65535 || !process.env.DEMO_CONTROL_SECRET
    || typeof owner.token !== 'string' || !equalSecret(owner.token, process.env.DEMO_CONTROL_SECRET)) throw new Error('OPERATOR_HOST_MISMATCH');
  const response = await fetch(`http://127.0.0.1:${owner.port}/${action}`, {
    method: action === 'reset' ? 'POST' : 'GET', headers: { authorization: `Bearer ${owner.token}` },
    signal: AbortSignal.timeout(action === 'reset' ? 130_000 : 30_000), redirect: 'error', cache: 'no-store',
  });
  if (!response.ok) throw new Error('OPERATOR_CONTROL_UNAVAILABLE');
  return response.json();
}
