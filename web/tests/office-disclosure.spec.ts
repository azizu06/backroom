import { test, expect } from '@playwright/test';
import { openMenu, openSheet } from './office-menu';

// #311 removed the floating demo disclosure pill from the office shell.
for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`office disclosure at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('keeps the demo disclosure pill out of the sidebar shell', async ({ page }) => {
      await page.goto('/office?view=overview');
      await openMenu(page);
      await expect(page.locator('.office-disclosure .demo-pill')).toHaveCount(0);
      await expect(page.getByLabel('Demo disclosure')).toHaveCount(0);

      await page.keyboard.press('o');
      await expect(page.getByLabel('Office view')).toHaveValue('play');
      await expect(page.getByLabel('Demo disclosure')).toHaveCount(0);

      await openSheet(page, 'help');
      await expect(page.getByLabel('Demo disclosure')).toHaveCount(0);
      await page.getByRole('button', { name: 'Close Help' }).click();

      await expect(page.getByRole('button', { name: 'Play (First Person)', exact: true })).toBeVisible();
    });
  });
}
