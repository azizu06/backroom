import { test, expect, type Page } from '@playwright/test';

const surface = (page: Page) => page.getByRole('application', { name: /First-person office/ });
async function player(page: Page) {
  return surface(page).evaluate(element => {
    const { playerX, playerZ } = (element as HTMLElement).dataset;
    if (playerX === undefined || playerZ === undefined) throw new Error('Play rig has not reported a pose');
    return { x: Number(playerX), z: Number(playerZ) };
  });
}
async function walkForward(page: Page, timeout: number) {
  const start = await player(page);
  await page.keyboard.down('w');
  try {
    await expect.poll(async () => start.z - (await player(page)).z, { timeout, intervals: [20] }).toBeGreaterThan(0.03);
    expect(Math.abs((await player(page)).x - start.x)).toBeLessThan(0.05);
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
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await surface(page).focus();
  await expect(surface(page)).toBeFocused();
  await page.waitForTimeout(1200);
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
  await walkForward(page, 2000);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('office-viewport').getByText('Loading 3D office…')).toHaveCount(0);
  await surface(page).focus();
  // The scene module is loaded; with no intro its first frame already reports the pose.
  await page.waitForTimeout(100);
  // No intro wait: the spawn pose (z 0.900) and movement must arrive before a 900 ms glide could finish.
  await expect(surface(page)).toHaveAttribute('data-player-z', '0.900', { timeout: 400 });
  await walkForward(page, 400);
  expect(errors).toEqual([]);
});
