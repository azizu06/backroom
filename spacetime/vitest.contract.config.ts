import { defineConfig } from 'vitest/config';
import { spacetimedbModuleTestPlugin } from 'spacetimedb/server/test-utils/vitest';
export default defineConfig({
  plugins: [spacetimedbModuleTestPlugin()],
  test: {
    globals: true,
    setupFiles: ['tests/contract-setup.ts'],
    include: ['../orchestrator/src/{store,audit,llm-off,policy-gate}.test.ts', '../orchestrator/src/core-demo/core.test.ts', '../orchestrator/src/approvals/service.test.ts', '../web/lib/gateway/**/*.test.mjs'],
    testTimeout: 15000,
  },
});
