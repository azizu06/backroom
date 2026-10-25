import { test, expect } from '@playwright/test';
import { openMenu } from './office-menu';

/** Start in the west corridor and cross the real layout opening with keyboard movement. */
test('walks from the corridor into the atrium without a wall or furniture blocking the opening', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?playSpawn=-10.8,0&perf=1&view=overview');
  const view = page.getByLabel('Office view');
  await expect(view).toBeEnabled();
  await openMenu(page);
  await view.selectOption({ label: 'Play (first person)' });
  const surface = page.getByRole('application', { name: /First-person office/ });
  await expect(surface).toBeFocused();
  await expect(surface).toHaveAttribute('data-player-x', /-10\.8/, { timeout: 15_000 });
  // Yaw zero faces north; A strafes west through the atrium's 2.4 m opening.
  await page.keyboard.down('a');
  try {
    await expect.poll(async () => Number(await surface.getAttribute('data-player-x')), { timeout: 15_000 }).toBeLessThan(-14);
  } finally {
    await page.keyboard.up('a');
  }
  const x = Number(await surface.getAttribute('data-player-x'));
  const z = Number(await surface.getAttribute('data-player-z'));
  expect(x).toBeGreaterThan(-24);
  expect(z).toBeGreaterThan(-0.3);
  expect(z).toBeLessThan(0.3);
  await expect(page.getByTestId('office-perf-calls')).toHaveText(/^\d+$/);
  console.info(`Atrium Play: ${await page.getByTestId('office-perf-calls').textContent()} rendered draw calls, ${await page.getByTestId('office-perf').locator('dt').filter({ hasText: /^triangles$/ }).locator('..').locator('dd').textContent()} triangles`);
  expect(errors).toEqual([]);
});
