import { test, expect, type Page } from '@playwright/test';
import { openMenu, openSheet } from './office-menu';

// /office uses AJ’s sidebar + topbar shell; the 3D scene fills the main pane, not the whole window.
const BANNED = /\b(demo|synthetic|fake|sandbox|simulated|simulation|preview|hackathon)\b/i;
const visibleText = (page: Page) => page.locator('.office-shell').evaluate(element => (element as HTMLElement).innerText);

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('the shell keeps a sidebar and topbar beside a measured 3D viewport', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/office?view=overview');
      await openMenu(page);

      const canvas = page.getByTestId('office-viewport').locator('canvas');
      await expect(canvas).toBeVisible();
      await expect(page.getByTestId('office-viewport').getByText('Loading 3D office…')).toHaveCount(0);
      await expect.poll(() => canvas.boundingBox().then(box => box && box.width > 200 && box.height > 200), { timeout: 15_000 }).toBe(true);

      await expect(page.getByRole('complementary', { name: 'Office navigation' })).toBeVisible();
      await expect(page.getByTestId('office-topbar')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Backroom menu' })).toHaveCount(0);
      await expect(page.locator('.office-corner')).toHaveCount(0);

      for (const name of ['Full Floor', 'Rooms', 'Audit Wall', 'Help']) {
        await expect(page.getByRole('complementary', { name: 'Office navigation' }).getByRole('button', { name, exact: true })).toBeVisible();
      }
      await expect(page.getByRole('button', { name: 'Play (First Person)', exact: true })).toBeVisible();
      await expect(page.getByLabel('Office view')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sound off', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Full Screen', exact: true })).toBeVisible();
      expect(await visibleText(page)).not.toMatch(BANNED);

      await openSheet(page, 'overview');
      await expect(page.getByRole('heading', { name: 'Today at Backroom' })).toBeVisible();
      expect(await visibleText(page)).not.toMatch(BANNED);
      await page.getByRole('button', { name: 'Close Today at Backroom' }).click();
      await expect(page.getByRole('dialog', { name: 'Today at Backroom' })).toHaveCount(0);

      await openSheet(page, 'help');
      await expect(page.getByRole('heading', { name: 'Things to Try' })).toBeVisible();
      await expect(page.getByText('Test the Treasury Lock')).toBeVisible();
      await page.getByRole('button', { name: 'Close Help' }).click();
      expect(errors).toEqual([]);
    });
  });
}
