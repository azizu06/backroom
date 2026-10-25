import { expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { OwnedProcesses } from '../../tools/demo/processes';

it('stops its child group and leaves an unrelated process alive', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'backroom-demo-'));
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
  const owned = new OwnedProcesses(directory, process.env);
  const child = owned.start(process.execPath, ['-e', 'setInterval(()=>{},1000)'], join(directory, 'owned.log'));
  const web = owned.start(process.execPath, ['-e', 'setInterval(()=>{},1000)'], join(directory, 'web.log'));
  try {
    await Promise.all([once(child, 'spawn'), once(web, 'spawn'), once(unrelated, 'spawn')]);
    await owned.stop(child);
    expect(child.signalCode).toBe('SIGTERM');
    expect(() => process.kill(web.pid!, 0)).not.toThrow();
    await owned.stop(unrelated); // A caller cannot signal an unowned child.
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    await owned.stop();
    expect(web.signalCode).toBe('SIGTERM');
    await owned.stop(); // Repeated down cannot signal a reused persisted PID.
  } finally { await owned.stop(); unrelated.kill(); await once(unrelated, 'exit'); rmSync(directory, { recursive: true }); }
});

it('passes the same complete environment to every child without an allowlist', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'backroom-demo-env-'));
  const names = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'CRS_USERNAME', 'CRS_PASSWORD', 'NESSIE_API_KEY',
    'NESSIE_ACCOUNT_ID', 'CARTESIA_API_KEY', 'CARTESIA_WEBHOOK_SECRET', 'DEMO_PUBLIC_URL', 'APIFY_TOKEN'];
  const env = { ...process.env, ...Object.fromEntries(names.map(name => [name, `dummy-${name}`])) };
  const owned = new OwnedProcesses(directory, env);
  try {
    for (const processName of ['state', 'build', 'attack', 'voice', 'web']) {
      const output = join(directory, `${processName}.json`);
      await owned.run(process.execPath, ['-e', `const fs=require('node:fs');const names=${JSON.stringify(names)};fs.writeFileSync(${JSON.stringify(output)},JSON.stringify(names.filter(name=>!!process.env[name])))`], join(directory, `${processName}.log`));
      expect(JSON.parse(readFileSync(output, 'utf8'))).toEqual(names);
    }
  } finally { await owned.stop(); rmSync(directory, { recursive: true }); }
});
