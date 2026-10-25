import type { ChildProcess } from 'node:child_process';
import type { OwnedProcesses } from './processes';

type StateConfig = { uri: string; database: string; token: string };

/** The supervisor replaces only its own attack child, re-arming the one-attempt analyst. */
export function createAttackDemoProcess(options: {
  children: Pick<OwnedProcesses, 'start' | 'stop'>; env: NodeJS.ProcessEnv;
  loader: string; log: string; ready: () => Promise<void>;
}) {
  let child: ChildProcess | undefined;
  return {
    async stop() {
      if (child) await options.children.stop(child);
      child = undefined;
    },
    async start(config?: StateConfig) {
      const env: NodeJS.ProcessEnv = { ...options.env,
        ...(config ? { SPACETIMEDB_URI: config.uri, SPACETIMEDB_DATABASE: config.database, SPACETIMEDB_TOKEN: config.token } : {}),
      };
      // Mock analysis must never subscribe to the company database.
      if (env.ATTACK_DEMO_LIVE !== '1') env.STATE_STORE = 'memory';
      child = options.children.start(process.execPath,
        ['--import', options.loader, 'orchestrator/src/attack-demo/server.ts'], options.log, env);
      await options.ready();
    },
  };
}

/** Both CLI reset and the operator button enter this supervisor transaction. */
export async function resetCompany<T>(options: {
  publish: () => Promise<StateConfig | undefined>;
  resetWeb: (config: StateConfig | undefined) => Promise<T>;
  attack: { stop: () => Promise<void>; start: (config?: StateConfig) => Promise<void> };
}): Promise<T> {
  const config = await options.publish();
  await options.attack.stop();
  const status = await options.resetWeb(config);
  await options.attack.start(config);
  return status;
}
