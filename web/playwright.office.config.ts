import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: /office-.*\.spec\.ts/, workers: 1, retries: 0,
  use: { baseURL: 'http://localhost:3035', headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: 'pnpm exec next start --port 3035', url: 'http://localhost:3035/office', reuseExistingServer: false,
    env: { WEBAUTHN_ORIGIN: 'http://localhost:3035', WEBAUTHN_RP_ID: 'localhost',
      CONTROLLER_ENROLLMENT_SECRET: 'local-audit-test-only', TOOL_GATEWAY_SECRET: 'local-tool-test-only',
      STATE_STORE: 'memory', BACKROOM_APPROVAL_DEMO: '1', OPENROUTER_API_KEY: '' },
  },
});
