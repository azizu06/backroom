import { test, expect, type Page } from '@playwright/test';

const surface = (page: Page) => page.getByRole('application', { name: /First-person office/ });
async function walkForward(page: Page, timeout: number) {
  await page.keyboard.down('w');
  try {
    // Sample on the page. A Playwright poll round-trip can use up the whole 400 ms budget before the second read.
    const delta = await page.evaluate(async (limit) => {
      const surface = document.querySelector<HTMLElement>('[role="application"]');
      if (!surface?.dataset.playerZ || !surface.dataset.playerX) return null;
      const startZ = Number(surface.dataset.playerZ);
      const startX = Number(surface.dataset.playerX);
      const started = performance.now();
      let x = startX;
      let z = startZ;
      while (performance.now() - started < limit) {
        x = Number(surface.dataset.playerX);
        z = Number(surface.dataset.playerZ);
        if (startZ - z > 0.03) return { x: x - startX, z: startZ - z };
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      }
      return { x: x - startX, z: startZ - z };
    }, timeout);
    expect(delta?.z ?? 0).toBeGreaterThan(0.03);
    expect(Math.abs(delta?.x ?? 1)).toBeLessThan(0.05);
  } finally {
    await page.keyboard.up('w');
  }
}

test('Play hands control over after the intro and immediately with reduced motion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/office?view=overview');
  const available = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  expect(available, 'Play requires WebGL').toBe(true);
  const view = page.getByLabel('Office view');
  await expect(view).toHaveValue('walk');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await view.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await page.waitForTimeout(1200);
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
  await walkForward(page, 2000);

  await page.keyboard.press('Escape');
  await expect(view).toHaveValue('walk');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await view.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  // No intro wait: the fresh spawn pose (z 0.600, not the previous session's) and movement must arrive before a 900 ms glide could finish.
  await expect(surface(page)).toHaveAttribute('data-player-z', '0.600', { timeout: 400 });
  await walkForward(page, 400);
  expect(errors).toEqual([]);
});
