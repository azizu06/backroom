import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { OwnedProcesses } from './processes';

/** Fresh databases, isolated publisher credentials, loopback only. Never deletes shared data. */
export function localSpacetime(root: string, env: NodeJS.ProcessEnv, children: OwnedProcesses) {
  const dir = join(root, '.demo');
  const cli = env.SPACETIME_CLI || (existsSync(join(dir, 'spacetime/spacetime')) ? join(dir, 'spacetime/spacetime') : 'spacetime');
  const cliRoot = env.SPACETIME_ROOT || (existsSync(join(dir, 'spacetime/spacetime')) ? join(dir, 'spacetime') : undefined);
  const config = join(dir, 'publisher.toml');
  const prefix = [...(cliRoot ? [`--root-dir=${cliRoot}`] : []), `--config-path=${config}`];
  const port = Number(env.DEMO_STATE_PORT || 3115);
  const http = `http://127.0.0.1:${port}`;
  return {
    port,
    async start() {
      // Isolated config starts private even if the CLI's normal umask is permissive.
      if (!existsSync(config)) writeFileSync(config, '', { mode: 0o600 });
      const versionLog = join(dir, 'spacetime-version.log'); writeFileSync(versionLog, '');
      await children.run(cli, [...prefix, '--version'], versionLog);
      if (!readFileSync(versionLog, 'utf8').includes('2.13.0')) throw new Error('DEMO_SPACETIME_VERSION: install CLI 2.13.0');
      mkdirSync(join(dir, 'state'), { recursive: true, mode: 0o700 });
      children.start(cli, [...prefix, 'start', '--listen-addr', `127.0.0.1:${port}`,
        '--data-dir', join(dir, 'state'), '--non-interactive'], join(dir, 'spacetime.log'));
    },
    async publish() {
      const database = `backroom-demo-${Date.now()}-${randomBytes(3).toString('hex')}`;
      await children.run(cli, [...prefix, 'publish', database, '--server', http,
        '--module-path', 'spacetime', '--yes'], join(dir, 'publish.log'));
      const token = /^spacetimedb_token\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1];
      if (!token) throw new Error('DEMO_SPACETIME_PUBLISHER_MISSING');
      return { uri: `ws://127.0.0.1:${port}`, database, token };
    },
  };
}
