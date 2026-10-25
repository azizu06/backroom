import { test, expect } from '@playwright/test';

test('opt-in office performance shows rendered draw calls without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?perf=1&view=overview');
  const overlay = page.getByRole('complementary', { name: 'Office performance' });
  // The overlay mounts inside the lazy WebGL scene, after its first shader compile.
  // This checks readiness, not a five-second scene-loading budget.
  await expect(overlay).toBeVisible({ timeout: 20_000 });
  await expect(overlay).toContainText('draw calls');
  await expect(page.getByTestId('office-perf-calls')).toHaveText(/^\d+$/);
  await expect.poll(async () => Number(await page.getByTestId('office-perf-calls').textContent())).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
