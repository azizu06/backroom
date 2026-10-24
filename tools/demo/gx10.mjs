#!/usr/bin/env node
// SSH arguments are allowlisted before entering the remote shell. Secrets travel on stdin only.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const action = process.argv[2];
const host = process.env.GX10_HOST || 'gx10';
const dir = process.env.GX10_DEPLOY_DIR || 'work/backroom-judge-host';
const ref = process.env.GX10_REF || 'main';
if (!['up', 'down', 'health'].includes(action) || !/^[a-zA-Z0-9_.@-]+$/.test(host) || host.startsWith('-') ||
    !/^work\/[a-zA-Z0-9_-]+$/.test(dir) || !/^[a-zA-Z0-9_/-]+$/.test(ref) || ref.includes('..') || ref.startsWith('-')) {
  console.error('Usage: demo:{up,down,health}:gx10; invalid host, work/<directory> or branch.'); process.exit(2);
}
function ssh(command, input, capture = false) {
  const result = spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, command], {
    input, encoding: 'utf8', stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) { console.error('GX10 operation failed; inspect private host logs.'); process.exit(result.status || 1); }
  return result.stdout;
}
if (action === 'up') {
  const key = spawnSync('security', ['find-generic-password', '-s', 'backroom-anthropic-key', '-w'], { encoding: 'utf8' });
  if (key.status !== 0 || !key.stdout.trim() || /[\r\n]/.test(key.stdout.trim())) {
    console.error('Private Anthropic Keychain item unavailable; no deployment changed.'); process.exit(1);
  }
  // Never write this key to the shared sponsor env or the local repository.
  ssh(`umask 077; mkdir -p "$HOME/${dir}"; cat > "$HOME/${dir}/anthropic.env"; chmod 600 "$HOME/${dir}/anthropic.env"`,
    `ANTHROPIC_API_KEY=${key.stdout.trim()}\n`, true);
  ssh(`bash -s -- '${dir}'`, readFileSync(new URL('./gx10-bootstrap.sh', import.meta.url), 'utf8'));
}
ssh(`bash -s -- '${dir}' '${action}' '${ref}' '${process.argv.includes('--live') ? '1' : '0'}'`,
  readFileSync(new URL('./gx10-remote.sh', import.meta.url), 'utf8'));
