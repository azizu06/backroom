import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/payments', workers: 1,
  use: { baseURL: 'http://127.0.0.1:3031', viewport: { width: 390, height: 844 }, headless: true },
  webServer: { command: 'BACKROOM_PAYMENT_DEMO=1 pnpm exec next dev --hostname 127.0.0.1 --port 3031',
    url: 'http://127.0.0.1:3031/pay/payment-demo-1042', reuseExistingServer: false, timeout: 120000 },
});
