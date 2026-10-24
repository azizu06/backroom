// Run from any directory; private state always belongs to this worktree.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const child = spawn(process.execPath, ['--env-file=.env.local', '--import', import.meta.resolve('tsx'),
  fileURLToPath(new URL('./live.ts', import.meta.url)), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
