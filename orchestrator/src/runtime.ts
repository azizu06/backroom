import { existsSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { MemoryStateStore, type StateStore } from './store';
import { SpacetimeStateStore } from './spacetime-store';

const cwd = process.cwd();
const repo = ['web', 'orchestrator', 'spacetime'].includes(basename(cwd)) ? dirname(cwd) : cwd;
const localEnv = resolve(repo, '.env.local');
if (existsSync(localEnv)) process.loadEnvFile(localEnv);

// One process-wide store for control, routers, workers and approval route chunks.
// Each server process uses the same database and private writer identity in durable mode.
const root = globalThis as typeof globalThis & { backroomStateStore?: StateStore };
export function createStateStoreFromEnv(env: NodeJS.ProcessEnv = process.env): StateStore {
  const kind = env.STATE_STORE ?? 'memory';
  if (kind === 'memory') return new MemoryStateStore();
  if (kind !== 'spacetime') throw new Error('INVALID_STATE_STORE');
  return new SpacetimeStateStore({ uri: env.SPACETIMEDB_URI ?? '', database: env.SPACETIMEDB_DATABASE ?? '', token: env.SPACETIMEDB_TOKEN ?? '' });
}
root.backroomStateStore ??= process.env.VITEST ? new MemoryStateStore() : createStateStoreFromEnv();
export const getStateStore = (): StateStore => root.backroomStateStore!;
export async function installStateStore(adapter: StateStore): Promise<void> {
  // Fence outstanding calls against the old store before replacing it.
  await getStateStore().setLlmEnabled(false);
  root.backroomStateStore = adapter;
}
