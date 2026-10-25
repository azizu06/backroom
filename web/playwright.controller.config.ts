import { defineConfig } from '@playwright/test';
// Own server: Dana's passkey enrollment is once per process, so this spec cannot share approval.spec's server.
export default defineConfig({
  testDir: './tests', testMatch: ['controller-inbox.spec.ts'], workers: 1, retries: 0,
  use: { baseURL: 'http://localhost:3036', headless: true, viewport: { width: 390, height: 844 } },
  webServer: {
    command: 'pnpm exec next start --port 3036', url: 'http://localhost:3036/controller', reuseExistingServer: false,
    env: { WEBAUTHN_ORIGIN: 'http://localhost:3036', WEBAUTHN_RP_ID: 'localhost',
      CONTROLLER_ENROLLMENT_SECRET: 'local-browser-test-only', TOOL_GATEWAY_SECRET: 'local-tool-test-only', BACKROOM_APPROVAL_DEMO: '1' },
  },
});
