import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'judge-path.spec.ts', workers: 1, retries: 0,
  use: { baseURL: 'http://localhost:3049', headless: true, trace: 'retain-on-failure', actionTimeout: 15_000 },
  webServer: { command: 'pnpm --filter @backroom/orchestrator exec tsx ../web/tests/judge-path.host.ts',
    url: 'http://127.0.0.1:3049/inbox', reuseExistingServer: false, timeout: 120_000 },
});
