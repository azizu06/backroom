import { test, expect } from '@playwright/test';

// Real Next production server. Unknown routes must land on a branded 404 with a way back, at laptop and phone widths.
for (const viewport of [{ width: 1440, height: 1100 }, { width: 390, height: 844 }]) {
  test('unknown route shows the Backroom 404 at ' + viewport.width + 'px', async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto('/no-such-room');
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle('Page not found · Backroom');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This room is not on the floor plan.');
    await expect(page.locator('h1')).toHaveCount(1);
    const recovery = page.getByRole('navigation', { name: 'Recovery' });
    await expect(recovery.getByRole('link', { name: 'Back to the office' })).toHaveAttribute('href', '/office');
    await expect(recovery.getByRole('link', { name: 'Open the audit wall' })).toHaveAttribute('href', '/audit');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await recovery.getByRole('link', { name: 'Open the audit wall' }).click();
    await expect(page).toHaveURL(/\/audit$/);
    expect(errors).toEqual([]);
  });
}
