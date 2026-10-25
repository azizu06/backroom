import { test, expect } from '@playwright/test';

test('opt-in office performance shows rendered draw calls without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?perf=1&view=overview');
  const overlay = page.getByRole('complementary', { name: 'Office performance' });
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText('draw calls');
  await expect(page.getByTestId('office-perf-calls')).toHaveText(/^\d+$/);
  expect(Number(await page.getByTestId('office-perf-calls').textContent())).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
