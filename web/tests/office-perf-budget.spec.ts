import { test, expect, type Page } from '@playwright/test';
import { openMenu } from './office-menu';

// Run via test:office:browser after building the web app. Reads the opt-in ?perf=1 overlay (all passes, shadows included).
const MOVING_PLAY_DRAW_BUDGET = 300;

function surface(page: Page) {
  return page.getByRole('application', { name: /First-person office/ });
}
const calls = async (page: Page) => Number(await page.getByTestId('office-perf-calls').textContent());
const frameMs = async (page: Page) => Number(await page.getByTestId('office-perf').locator('dd').nth(4).locator('span').textContent());
const position = (page: Page) => surface(page).evaluate(element => `${(element as HTMLElement).dataset.playerX},${(element as HTMLElement).dataset.playerZ}`);

test('moving first-person Play stays within the draw-call budget', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?perf=1&view=overview');
  const select = page.getByLabel('Office view');
  await expect(select).toBeEnabled();
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await openMenu(page);
  await page.getByRole('button', { name: 'Play (First Person)', exact: true }).click();
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-x', /\d/, { timeout: 20_000 });

  // Warm up first (shader compiles and the first contact-shadow bake land in the 60-frame CPU window).
  await page.keyboard.down('ArrowLeft');
  try { await page.waitForTimeout(2500); } finally { await page.keyboard.up('ArrowLeft'); }
  const samples: { calls: number; ms: number }[] = [];
  // Walk the corridor and turn, so samples cover several rooms' doorways and windows, not just the spawn view.
  for (const key of ['w', 'ArrowLeft', 'w', 'ArrowRight', 's']) {
    const before = await position(page);
    await page.keyboard.down(key);
    try {
      // Moving frames render continuously; poll until the overlay reports one taken while the player moved.
      if (key === 'w' || key === 's') await expect.poll(() => position(page), { timeout: 10_000 }).not.toBe(before);
      await page.waitForTimeout(1200);
      samples.push({ calls: await calls(page), ms: await frameMs(page) });
    } finally { await page.keyboard.up(key); }
  }
  console.log(`moving Play perf samples: ${JSON.stringify(samples)}`);
  for (const sample of samples) {
    expect(sample.calls).toBeGreaterThan(0);
    expect(sample.calls).toBeLessThanOrEqual(MOVING_PLAY_DRAW_BUDGET);
  }
  expect(errors).toEqual([]);
});
