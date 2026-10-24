import { test, expect } from '@playwright/test';

// Real Next server; only the routes named below are intercepted, so no provider network is used.
test('a bad approval link shows "not found" and stops polling', async ({ page }) => {
  let views = 0;
  page.on('request', r => { if (r.url().includes('/api/approvals/') && r.url().endsWith('/view')) views++; });
  await page.goto('/approve/does-not-exist');
  await expect(page.getByRole('heading', { name: 'This approval link does not match a request.' })).toBeVisible();
  await expect(page.getByText('Request not found', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /with passkey/ })).toHaveCount(0);
  const seen = views;
  await page.waitForTimeout(2500);
  expect(views).toBe(seen);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('controller page waits for passkey status instead of flashing the enrollment form', async ({ page }) => {
  let release!: () => void;
  const answered = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/controller/view', async route => {
    await answered;
    await route.fulfill({ json: { registered: true } });
  });
  await page.goto('/controller');
  await expect(page.getByRole('status').filter({ hasText: 'Checking Dana’s passkey…' })).toBeVisible();
  await expect(page.getByLabel('Controller enrollment code')).toHaveCount(0);
  release();
  await expect(page.getByRole('heading', { name: 'Dana’s passkey is ready.' })).toBeVisible();
  await expect(page.getByLabel('Controller enrollment code')).toHaveCount(0);
});

test('controller page explains an HTML 502 and recovers on retry', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/controller/view', route => ++calls === 1
    ? route.fulfill({ status: 502, contentType: 'text/html', body: '<html><body>Bad gateway</body></html>' })
    : route.fulfill({ json: { registered: false } }));
  await page.goto('/controller');
  await expect(page.locator('main').getByRole('alert')).toHaveText('Backroom is not responding right now (HTTP 502). Try again in a moment.');
  await expect(page.getByLabel('Controller enrollment code')).toHaveCount(0);
  await page.getByRole('button', { name: 'Check passkey status again' }).click();
  await expect(page.getByLabel('Controller enrollment code')).toBeVisible();
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
});
