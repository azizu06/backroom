/** Reset rotates a fresh demo database; no existing database is ever erased. */
export function demoDatabaseTarget(env: NodeJS.ProcessEnv) {
  const mode = env.DEMO_SPACETIME || 'local';
  if (!['local', 'maincloud'].includes(mode)) throw new Error('DEMO_INVALID_SPACETIME');
  if (env.BACKROOM_DEMO !== '1') throw new Error('DEMO_MARKER_REQUIRED');
  if (mode === 'maincloud' && env.DEMO_MAINCLOUD !== '1') throw new Error('DEMO_MAINCLOUD_OPT_IN_REQUIRED');
  // Existing DB configuration must never be interpreted as a reset destination.
  if (mode === 'maincloud' && env.DEMO_STATE_REMOTE === '1') throw new Error('DEMO_CONFLICTING_STATE_MODES');
  if (env.DEMO_STATE_REMOTE !== '1' && env.SPACETIMEDB_DATABASE && !/^backroom-demo-[a-z0-9-]+$/.test(env.SPACETIMEDB_DATABASE)) {
    throw new Error('DEMO_NON_DEMO_DATABASE_REFUSED');
  }
  const port = Number(env.DEMO_STATE_PORT || 3115);
  return mode === 'maincloud'
    ? { mode, port, http: 'https://maincloud.spacetimedb.com', uri: 'wss://maincloud.spacetimedb.com' }
    : { mode, port, http: `http://127.0.0.1:${port}`, uri: `ws://127.0.0.1:${port}` };
}
