import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: ['audit.spec.ts', 'route-states.spec.ts', 'site-nav.spec.ts'], workers: 1, retries: 0,
  use: { baseURL: 'http://localhost:3031', headless: true, viewport: { width: 1440, height: 1100 } },
  webServer: {
    command: 'pnpm exec next start --port 3031', url: 'http://localhost:3031/audit', reuseExistingServer: false,
    env: { WEBAUTHN_ORIGIN: 'http://localhost:3031', WEBAUTHN_RP_ID: 'localhost',
      CONTROLLER_ENROLLMENT_SECRET: 'local-audit-test-only', TOOL_GATEWAY_SECRET: 'local-tool-test-only',
      BACKROOM_APPROVAL_DEMO: '1', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '' },
  },
});
