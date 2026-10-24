import { vi } from 'vitest';
import { SpacetimeStateStore } from '../../orchestrator/src/spacetime-store';
import { harnessStore } from './transport';

// Run existing public-contract suites against actual module reducers. Extending
// the adapter preserves deliberate failure/race overrides in recovery tests.
vi.mock('../../orchestrator/src/memory-store', async importOriginal => ({
  ...await importOriginal<typeof import('../../orchestrator/src/memory-store')>(),
  MemoryStateStore: class extends SpacetimeStateStore {
    constructor() { super({ transport: harnessStore().transport }); }
  },
}));
