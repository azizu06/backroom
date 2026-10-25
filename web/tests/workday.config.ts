import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'workday.spec.ts', workers: 1, retries: 0,
  outputDir: process.env.WORKDAY_PROOF_DIR || '/tmp/backroom-workday-browser',
  use: { baseURL: 'http://127.0.0.1:3057', headless: true, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm --filter @backroom/orchestrator exec tsx ../web/tests/workday.host.ts',
    url: 'http://127.0.0.1:3057/inbox', reuseExistingServer: false, timeout: 120_000 },
});
