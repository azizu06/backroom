import { defineConfig } from '@playwright/test';
// OFFICE_TEST_PORT lets parallel worktrees run the office suite side by side; 3035 stays the default.
const port = Number(process.env.OFFICE_TEST_PORT) || 3035;
const origin = `http://localhost:${port}`;
export default defineConfig({
  testDir: './tests', testMatch: /office-.*\.spec\.ts/, workers: 1, retries: 0,
  use: { baseURL: origin, headless: true, viewport: { width: 1440, height: 1000 } },
  webServer: {
    command: `pnpm exec next start --port ${port}`, url: `${origin}/office`, reuseExistingServer: false,
    env: { WEBAUTHN_ORIGIN: origin, WEBAUTHN_RP_ID: 'localhost',
      CONTROLLER_ENROLLMENT_SECRET: 'local-audit-test-only', TOOL_GATEWAY_SECRET: 'local-tool-test-only',
      STATE_STORE: 'memory', BACKROOM_APPROVAL_DEMO: '1', OPENROUTER_API_KEY: '', ANTHROPIC_API_KEY: '' },
  },
});
