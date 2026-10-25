import { defineConfig } from '@playwright/test';
// Runs against an already running owned demo host (`STATE_STORE=spacetime pnpm demo:up`); it starts no server.
// SINGLE_ORIGIN_URL is the host's declared public origin (the printed Office URL's origin).
export default defineConfig({
  testDir: './tests', testMatch: 'single-origin.spec.ts', workers: 1, retries: 0,
  outputDir: process.env.SINGLE_ORIGIN_OUTPUT || '../.demo/single-origin-browser',
  use: { baseURL: process.env.SINGLE_ORIGIN_URL || 'http://localhost:3000', headless: true, viewport: { width: 1440, height: 1000 } },
});
