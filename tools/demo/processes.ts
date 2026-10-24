import { spawn, type ChildProcess } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';

/** Only a live parent may signal its own child groups. No persisted PID is killed. */
export class OwnedProcesses {
  private children = new Set<ChildProcess>();
  constructor(private readonly cwd: string, private readonly env: NodeJS.ProcessEnv) {}
  start(command: string, args: string[], log: string): ChildProcess {
    const fd = openSync(log, 'a', 0o600);
    const child = spawn(command, args, { cwd: this.cwd, env: this.env, detached: true, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    this.children.add(child);
    child.once('exit', () => this.children.delete(child));
    child.once('error', () => this.children.delete(child));
    return child;
  }
  async run(command: string, args: string[], log: string) {
    const child = this.start(command, args, log);
    await new Promise<void>((resolve, reject) => {
      child.once('error', () => reject(new Error('DEMO_COMMAND_UNAVAILABLE')));
      child.once('exit', code => code === 0 ? resolve() : reject(new Error('DEMO_COMMAND_FAILED')));
    });
  }
  async stop() {
    await Promise.all([...this.children].map(child => new Promise<void>(resolve => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      const signal = (kind: NodeJS.Signals) => { try { process.kill(-child.pid!, kind); } catch { /* already exited */ } };
      const timer = setTimeout(() => signal('SIGKILL'), 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      signal('SIGTERM');
    })));
  }
}
