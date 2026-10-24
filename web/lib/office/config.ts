import type { OfficeConnectionConfig } from './spacetime';
/** Only public subscription coordinates cross the server/client boundary. */
export function officeConfig(env: Record<string, string | undefined>): OfficeConnectionConfig | null {
  const kind = env.STATE_STORE ?? 'memory';
  if (kind === 'memory') return null;
  if (kind !== 'spacetime') throw new Error('INVALID_STATE_STORE');
  if (!env.SPACETIMEDB_URI || !env.SPACETIMEDB_DATABASE) throw new Error('SPACETIME_CONFIG_REQUIRED');
  return { uri: env.SPACETIMEDB_URI, database: env.SPACETIMEDB_DATABASE };
}
