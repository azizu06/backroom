import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { demoBindHost } from './host';
import type { OwnedProcesses } from './processes';
import { demoDatabaseTarget } from '../../orchestrator/src/demo-ops/database';

/** Fresh databases, isolated publisher credentials, explicit private-interface binding. Never deletes shared data. */
export function localSpacetime(root: string, env: NodeJS.ProcessEnv, children: OwnedProcesses) {
  const target = demoDatabaseTarget(env);
  const dir = join(root, '.demo');
  const cli = env.SPACETIME_CLI || (existsSync(join(dir, 'spacetime/spacetime')) ? join(dir, 'spacetime/spacetime') : 'spacetime');
  const cliRoot = env.SPACETIME_ROOT || (existsSync(join(dir, 'spacetime/spacetime')) ? join(dir, 'spacetime') : undefined);
  // Hosted mode uses an explicitly supplied, already authenticated CLI config.
  const config = target.mode === 'maincloud' ? env.SPACETIME_CONFIG : join(dir, 'publisher.toml');
  if (!config) throw new Error('DEMO_MAINCLOUD_CONFIG_REQUIRED');
  // CLI 2.13.0 deadlocks if its root config is supplied a second time.
  const rootConfig = cliRoot ? resolve(cliRoot, 'config/cli.toml') : undefined;
  const prefix = [...(cliRoot ? [`--root-dir=${cliRoot}`] : []),
    ...(resolve(config) === rootConfig ? [] : [`--config-path=${config}`])];
  const { port } = target;
  const host = demoBindHost({ DEMO_BIND_HOST: env.DEMO_STATE_BIND_HOST });
  const address = `${host.includes(':') ? `[${host}]` : host}:${port}`;
  const http = target.mode === 'maincloud' ? target.http : `http://${address}`;
  return {
    port, host, http, mode: target.mode,
    async start() {
      if (target.mode === 'maincloud' && !existsSync(config)) throw new Error('DEMO_MAINCLOUD_CONFIG_REQUIRED');
      // Isolated config starts private even if the CLI's normal umask is permissive.
      if (!existsSync(config)) writeFileSync(config, '', { mode: 0o600 });
      const versionLog = join(dir, 'spacetime-version.log'); writeFileSync(versionLog, '');
      await children.run(cli, [...prefix, '--version'], versionLog);
      if (!readFileSync(versionLog, 'utf8').includes('2.13.0')) throw new Error('DEMO_SPACETIME_VERSION: install CLI 2.13.0');
      if (target.mode === 'maincloud') return;
      mkdirSync(join(dir, 'state'), { recursive: true, mode: 0o700 });
      children.start(cli, [...prefix, 'start', '--listen-addr', address,
        '--data-dir', join(dir, 'state'), '--non-interactive'], join(dir, 'spacetime.log'));
    },
    async publish() {
      const database = `backroom-demo-${Date.now()}-${randomBytes(3).toString('hex')}`;
      await children.run(cli, [...prefix, 'publish', database, '--server', http,
        '--module-path', 'spacetime', '--yes'], join(dir, 'publish.log'));
      const token = /^spacetimedb_token\s*=\s*"([^"]+)"/m.exec(readFileSync(config, 'utf8'))?.[1];
      if (!token) throw new Error('DEMO_SPACETIME_PUBLISHER_MISSING');
      return { uri: target.mode === 'maincloud' ? target.uri : `ws://${address}`, database, token };
    },
  };
}
