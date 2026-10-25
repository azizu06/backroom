import { test, expect, type Page } from '@playwright/test';

// /office is just the 3D world: the canvas fills the window and every control sits in one corner menu, closed by default.
const BANNED = /\b(demo|synthetic|fake|sandbox|simulated|simulation|preview|hackathon)\b/i;
const visibleText = (page: Page) => page.locator('.office-shell').evaluate(element => (element as HTMLElement).innerText);

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('the canvas fills the window and only the corner menu sits over it', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/office?view=overview');
      const canvas = page.getByTestId('office-viewport').locator('canvas');
      await expect(canvas).toBeVisible();
      await expect.poll(() => canvas.boundingBox()).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
      const menu = page.getByRole('button', { name: 'Backroom menu' });
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      for (const name of ['Office view', 'Overview', 'Enter first person', 'Guide', 'Sound off', 'Office panels']) {
        await expect(page.getByRole(name === 'Office view' ? 'combobox' : 'button', { name, exact: name !== 'Enter first person' && name !== 'Office panels' })).toHaveCount(0);
      }
      const corner = await page.locator('.office-corner').boundingBox();
      expect(corner!.width).toBeLessThan(160);
      expect(corner!.height).toBeLessThan(60);
      await expect(page.locator('.office-caption')).toHaveCount(0);
      expect(await visibleText(page)).not.toMatch(BANNED);

      await menu.click();
      for (const name of ['Overview', 'Guide', 'Sound off']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Enter first person/ })).toBeVisible();
      await expect(page.getByLabel('Office view')).toBeVisible();
      expect(await visibleText(page)).not.toMatch(BANNED);
      await page.getByRole('button', { name: /^Office panels/ }).click();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#office-drawer')).toBeVisible();
      expect(await visibleText(page)).not.toMatch(BANNED);
      await page.getByRole('button', { name: 'Close office panels' }).click();
      await expect(menu).toBeFocused();
      expect(errors).toEqual([]);
    });
  });
}
