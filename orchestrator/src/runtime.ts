import { MemoryStateStore, type StateStore } from './store';

// One process-wide store for the control endpoint, routers, and seat workers.
// #15 replaces this development adapter with the shared durable state layer.
let store: StateStore = new MemoryStateStore();
export const getStateStore = (): StateStore => store;
export async function installStateStore(adapter: StateStore): Promise<void> {
  // Fence outstanding calls against the old store before replacing it.
  await store.setLlmEnabled(false);
  store = adapter;
}
