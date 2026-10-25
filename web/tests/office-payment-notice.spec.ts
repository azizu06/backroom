import { test, expect } from '@playwright/test';
import { openPanels } from './office-menu';

test('payment notice tracks the active link and remembers dismissal per code', async ({ page }) => {
  let active: { code: string; expiresAt: number } | null = null;
  await page.route('**/api/pay/active', route => route.fulfill({ json: { active } }));
  await page.goto('/office?view=overview');
  const notice = page.locator('.office-payment-toast');
  await expect(notice).toHaveCount(0);
  active = { code: 'AABBCCDDEE', expiresAt: Date.now() + 60_000 };
  await expect(notice).toBeVisible({ timeout: 10_000 });
  active = null;
  await expect(notice).toHaveCount(0, { timeout: 10_000 });
  active = { code: '1122334455', expiresAt: Date.now() - 1 };
  await page.reload();
  await expect(notice).toHaveCount(0);
  active = { code: 'AABBCCDDEE', expiresAt: Date.now() + 60_000 };
  await expect(notice).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Dismiss payment link notice' }).click();
  await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('backroom.payment-dismissed.AABBCCDDEE'))).toBe('1');
  await expect(notice).toHaveCount(0);
  active = { code: 'FFEEDDCCBB', expiresAt: Date.now() + 60_000 };
  await expect(notice).toBeVisible({ timeout: 10_000 });
  active = { ...active, expiresAt: Date.now() - 1 };
  await expect(notice).toHaveCount(0, { timeout: 10_000 });
});

test('anonymous office and audit show sign-in without protected audit requests or console errors', async ({ page }) => {
  const protectedReads: string[] = [], errors: string[] = [];
  page.on('request', request => { if (/\/api\/audit\/(entries|why)/.test(request.url())) protectedReads.push(request.url()); });
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
  await openPanels(page);
  await expect(page.locator('#office-audit-wall').getByLabel('Operator code')).toBeVisible();
  await page.goto('/audit');
  await expect(page.getByLabel('Operator code')).toBeVisible();
  expect(protectedReads).toEqual([]);
  expect(errors).toEqual([]);
});
