import { isIP } from 'node:net';

/** Only explicit IP listeners: never accidentally expose the host on every interface. */
export function demoBindHost(env: NodeJS.ProcessEnv): string {
  const host = env.DEMO_BIND_HOST || '127.0.0.1';
  if (!isIP(host) || host === '0.0.0.0' || host === '::') throw new Error('DEMO_INVALID_BIND_HOST');
  return host;
}

/** External databases are operator-selected, never republished/reset by this host. */
export function externalState(env: NodeJS.ProcessEnv) {
  if (env.DEMO_STATE_REMOTE !== '1') return undefined;
  if (env.STATE_STORE !== 'spacetime' || !env.SPACETIMEDB_URI || !env.SPACETIMEDB_DATABASE || !env.SPACETIMEDB_TOKEN) {
    throw new Error('DEMO_EXTERNAL_STATE_CONFIG_REQUIRED');
  }
  const uri = new URL(env.SPACETIMEDB_URI);
  if (uri.protocol !== 'wss:') throw new Error('DEMO_EXTERNAL_STATE_REQUIRES_WSS');
  return { uri: env.SPACETIMEDB_URI, database: env.SPACETIMEDB_DATABASE, token: env.SPACETIMEDB_TOKEN };
}
