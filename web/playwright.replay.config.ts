import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'replay.spec.ts', workers: 1, retries: 0,
  use: { baseURL: 'http://localhost:3254', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: { command: 'pnpm exec next start --port 3254', url: 'http://localhost:3254/office?replay=core-offline', reuseExistingServer: false },
});
