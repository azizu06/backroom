import { vi } from 'vitest';
import { harnessStore } from './transport';

// Run the existing public-contract suites unchanged against the actual module
// reducers; no network, alternate transition implementation, or real services.
vi.mock('../../orchestrator/src/memory-store', async importOriginal => ({
  ...await importOriginal<typeof import('../../orchestrator/src/memory-store')>(),
  MemoryStateStore: class { constructor() { return harnessStore().store; } },
}));
