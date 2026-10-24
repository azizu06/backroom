import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: ['approval.spec.ts', 'approval-states.spec.ts'], workers: 1, retries: 0,
  use: { baseURL: 'http://localhost:3020', headless: true, viewport: { width: 390, height: 844 } },
  webServer: {
    command: 'pnpm exec next start --port 3020', url: 'http://localhost:3020/controller', reuseExistingServer: false,
    env: { WEBAUTHN_ORIGIN: 'http://localhost:3020', WEBAUTHN_RP_ID: 'localhost',
      CONTROLLER_ENROLLMENT_SECRET: 'local-browser-test-only', TOOL_GATEWAY_SECRET: 'local-tool-test-only', BACKROOM_APPROVAL_DEMO: '1' },
  },
});
