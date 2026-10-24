import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: ['policy.spec.ts', 'fetch-errors.spec.ts'], workers: 1, retries: 0,
  use: { baseURL: 'http://localhost:3034', headless: true, viewport: { width: 1440, height: 1100 } },
  webServer: {
    command: 'pnpm exec next start --port 3034', url: 'http://localhost:3034/policy', reuseExistingServer: false,
    env: { WEBAUTHN_ORIGIN: 'http://localhost:3034', WEBAUTHN_RP_ID: 'localhost',
      CONTROLLER_ENROLLMENT_SECRET: 'local-policy-audit-only', TOOL_GATEWAY_SECRET: 'local-tool-test-only',
      POLICY_DEMO_PIN: 'local-owner-pin-only', BACKROOM_APPROVAL_DEMO: '1', OPENROUTER_API_KEY: '' },
  },
});
