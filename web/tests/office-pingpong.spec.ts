import { expect, test } from '@playwright/test';

for (const reducedMotion of ['reduce', 'no-preference'] as const) {
  test(`E starts ping pong, mouse and A/D move the paddle, Escape restores first person (${reducedMotion})`, async ({ page }) => {
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ reducedMotion });
    await page.goto('/office?playSpawn=9.5,4&view=overview');
    await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
    await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
    const surface = page.getByRole('application', { name: /First-person office/ });
    await expect(surface).toBeFocused();
    await expect(page.locator('.play-prompt')).toHaveText('E · Play ping pong', { timeout: 15_000 });
    const pose = await surface.evaluate(el => ({ ...((el as HTMLElement).dataset) }));
    const score = page.getByTestId('pingpong-score');
    await page.keyboard.press('e');
    await expect(score).toHaveAttribute('data-active', 'true');
    await expect(score).toHaveCSS('visibility', 'visible');
    await expect(score).toContainText('You 0 : 0 AI');
    await expect(score).toHaveAttribute('data-camera-x', /11\.450/);
    const bounds = await surface.boundingBox();
    if (!bounds) throw new Error('Missing play surface');
    await page.mouse.move(bounds.x + bounds.width * 0.9, bounds.y + bounds.height / 2);
    await expect.poll(async () => Number(await score.getAttribute('data-paddle-x'))).toBeGreaterThan(0.3);
    await page.keyboard.down('a');
    try {
      await expect.poll(async () => Number(await score.getAttribute('data-paddle-x'))).toBeLessThan(-0.2);
    } finally { await page.keyboard.up('a'); }
    await page.keyboard.down('d');
    try {
      await expect.poll(async () => Number(await score.getAttribute('data-paddle-x'))).toBeGreaterThan(0.2);
    } finally { await page.keyboard.up('d'); }
    // Reduced motion still runs the game; it only removes camera travel.
    await expect.poll(async () => Number(await score.getAttribute('data-ball-z'))).toBeGreaterThan(-1);
    await expect(surface).toHaveAttribute('data-player-x', pose.playerX!);
    await expect(surface).toHaveAttribute('data-player-z', pose.playerZ!);
    // The Sound toggle remains usable during a match; leaving returns keyboard focus to walking.
    await page.getByRole('button', { name: 'Sound off', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(score).toHaveAttribute('data-active', 'false');
    await expect(surface).toBeFocused();
    await expect(surface).toHaveAttribute('data-player-x', pose.playerX!);
    await expect(surface).toHaveAttribute('data-player-z', pose.playerZ!);
    await expect(surface).toHaveAttribute('data-player-yaw', pose.playerYaw!);
    await page.keyboard.down('w');
    try {
      await expect.poll(async () => Number(await surface.getAttribute('data-player-z'))).toBeLessThan(Number(pose.playerZ) - 0.05);
    } finally { await page.keyboard.up('w'); }
    expect(errors).toEqual([]);
  });
}

test('score card hides behind a wall in first person and returns in overview', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/office?playSpawn=9,0&view=overview');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  const view = page.getByLabel('Office view');
  const score = page.getByTestId('pingpong-score');
  await expect(score).toHaveCSS('visibility', 'visible');
  await view.selectOption({ label: 'Play (first person)' });
  await expect(page.getByRole('application', { name: /First-person office/ })).toHaveAttribute('data-player-x', '9.000');
  await expect(score).toHaveCSS('visibility', 'hidden');
  await view.selectOption({ label: 'Orbit camera' });
  await expect(score).toHaveCSS('visibility', 'visible');
});
