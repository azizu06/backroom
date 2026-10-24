import { MemoryStateStore, type StateStore } from './store';

// One process-wide store for control, routers, workers and approval route chunks.
// #15 replaces this development adapter with the shared durable state layer.
const root = globalThis as typeof globalThis & { backroomStateStore?: StateStore };
root.backroomStateStore ??= new MemoryStateStore();
export const getStateStore = (): StateStore => root.backroomStateStore!;
export async function installStateStore(adapter: StateStore): Promise<void> {
  // Fence outstanding calls against the old store before replacing it.
  await getStateStore().setLlmEnabled(false);
  root.backroomStateStore = adapter;
}
