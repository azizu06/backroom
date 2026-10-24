import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'operator.spec.ts', workers: 1, retries: 0,
  outputDir: process.env.OPERATOR_TEST_OUTPUT || '../.demo/operator-browser',
  use: { baseURL: 'http://127.0.0.1:3398', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'pnpm exec next start --hostname 127.0.0.1 --port 3398', url: 'http://127.0.0.1:3398/operator', reuseExistingServer: false,
    env: { STATE_STORE: 'memory', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '' },
  },
});
