import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: '.', testMatch: 'offline-standby.spec.ts', workers: 1, retries: 0,
  use: { baseURL: 'http://localhost:3254', headless: true, trace: 'retain-on-failure' },
  webServer: { command: 'pnpm exec next start --port 3254', url: 'http://localhost:3254/audit?replay=core-offline',
    cwd: resolve(__dirname, '..'),
    reuseExistingServer: false, env: { DEMO_LIVE: '0', DEMO_VOICE: '0' } },
});
