import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test, expect } from '@playwright/test';

const failure = 'Rendering failed. An action may already have completed. Check the audit record (/audit) before retrying.';

test('error screens say rendering failed and to check the audit record', ({}, testInfo) => {
  const app = join(dirname(testInfo.file), '../app');
  for (const file of ['error.tsx', 'global-error.tsx']) {
    const source = readFileSync(join(app, file), 'utf8');
    expect(source).toContain(failure);
    expect(source).not.toContain('no payment');
  }
  expect(readFileSync(join(app, 'not-found.tsx'), 'utf8')).toContain('Nothing was changed');
});

// Real Next production server. Unknown routes land on the shared site nav, at the review laptop and phone sizes.
for (const viewport of [{ width: 1440, height: 953 }, { width: 390, height: 844 }]) {
  test('unknown route has one site nav and does not overflow at ' + viewport.width + 'x' + viewport.height, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto('/no-such-room');
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle('Page not found · Backroom');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('This room is not on the floor plan.');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.getByRole('navigation')).toHaveCount(1);
    const nav = page.getByRole('navigation', { name: 'Site' });
    await expect(nav.getByRole('link', { name: 'Audit wall' })).toHaveAttribute('href', '/audit');
    await expect(nav.getByRole('link', { name: 'Back to the office' })).toHaveCount(0);
    const back = page.getByRole('link', { name: 'Back to the office' });
    await expect(back).toHaveAttribute('href', '/office');
    await expect(page.getByText('Nothing was changed')).toBeVisible();
    await expect(page.getByText('no payment')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const root = document.documentElement;
      return root.scrollHeight <= window.innerHeight && root.scrollWidth <= window.innerWidth;
    })).toBe(true);
    const backBox = await back.boundingBox();
    const footer = await page.getByText('Northfield Studio').boundingBox();
    expect(backBox).toBeTruthy();
    expect(footer).toBeTruthy();
    expect(backBox!.y + backBox!.height).toBeLessThanOrEqual(viewport.height + 1);
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height + 1);
    await nav.getByRole('link', { name: 'Audit wall' }).click();
    await expect(page).toHaveURL(/\/audit$/);
    expect(errors).toEqual([]);
  });
}
