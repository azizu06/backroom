import { test, expect } from '@playwright/test';

test('lobby props render and stamp the latest Treasury denial without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office');
  const viewport = page.getByTestId('office-viewport');
  await expect(viewport.locator('canvas')).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /^Inbox · \d+$/ })).toHaveCount(1);
  await expect(page.getByTestId('lobby-deny-stamp')).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview Treasury denial' }).click();
  await expect(page.getByTestId('lobby-deny-stamp')).toContainText('DENIED · NOT_IN_BADGE');
  await expect(viewport.locator('.floor-plan')).toHaveCount(0);
  await expect(page.getByText(/3D unavailable/).filter({ visible: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
