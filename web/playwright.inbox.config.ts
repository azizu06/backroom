import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'inbox.spec.ts', workers: 1, retries: 0,
  use: { baseURL: 'http://localhost:3033', headless: true, viewport: { width: 1440, height: 1050 } },
  webServer: {
    command: 'pnpm exec next start --port 3033', url: 'http://localhost:3033/inbox', reuseExistingServer: false,
    env: { WEBAUTHN_ORIGIN: 'http://localhost:3033', WEBAUTHN_RP_ID: 'localhost',
      CONTROLLER_ENROLLMENT_SECRET: 'local-inbox-test-only', TOOL_GATEWAY_SECRET: 'local-tool-test-only',
      GX10_ENABLED: 'false', OPENROUTER_API_KEY: '' },
  },
});
