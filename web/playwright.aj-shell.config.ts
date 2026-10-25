import { defineConfig } from '@playwright/test';

// Uses an already-running task build; deliberately never starts or refreshes a server.
// Run only after the orchestrator refreshes the task build (3200 may serve an older shell).
// OFFICE_SHELL_ORIGIN=http://127.0.0.1:3200 pnpm exec playwright test --config playwright.aj-shell.config.ts
export default defineConfig({
  testDir: './tests', testMatch: 'office-aj-shell.spec.ts', workers: 1, retries: 0,
  timeout: 120_000, expect: { timeout: 20_000 },
  outputDir: '/tmp/backrooms-aj-current/artifacts',
  reporter: [['list'], ['json', { outputFile: '/tmp/backrooms-aj-current/results.json' }]],
  use: {
    baseURL: process.env.OFFICE_SHELL_ORIGIN ?? 'http://127.0.0.1:3200',
    headless: true, serviceWorkers: 'block', reducedMotion: 'reduce',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
