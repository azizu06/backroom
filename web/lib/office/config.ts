import type { OfficeConnectionConfig } from './spacetime';
import { STATE_PROXY_PREFIX, stateProxyEnabled } from '../demo/state-proxy';
/** Only public subscription coordinates cross the server/client boundary. */
export function officeConfig(env: Record<string, string | undefined>): OfficeConnectionConfig | null {
  const kind = env.STATE_STORE ?? 'memory';
  if (kind === 'memory') return null;
  if (kind !== 'spacetime') throw new Error('INVALID_STATE_STORE');
  if (!env.SPACETIMEDB_URI || !env.SPACETIMEDB_DATABASE) throw new Error('SPACETIME_CONFIG_REQUIRED');
  // On the demo host the browser subscribes through the page's own origin (see demo/state-proxy).
  const proxied = env.DEMO_STATE_PROXY === '1' && stateProxyEnabled(env);
  return { uri: proxied ? STATE_PROXY_PREFIX : env.SPACETIMEDB_URI, database: env.SPACETIMEDB_DATABASE };
}
