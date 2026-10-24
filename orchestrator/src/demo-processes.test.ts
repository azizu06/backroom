import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { OwnedProcesses } from '../../tools/demo/processes';

it('stops its child group and leaves an unrelated process alive', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'backroom-demo-'));
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  const owned = new OwnedProcesses(directory, process.env);
  const child = owned.start(process.execPath, ['-e', 'setInterval(()=>{},1000)'], join(directory, 'owned.log'));
  try {
    await Promise.all([once(child, 'spawn'), once(unrelated, 'spawn')]);
    await owned.stop();
    expect(child.signalCode).toBe('SIGTERM');
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    await owned.stop(); // Repeated down cannot signal a reused persisted PID.
  } finally { unrelated.kill(); await once(unrelated, 'exit'); rmSync(directory, { recursive: true }); }
});
