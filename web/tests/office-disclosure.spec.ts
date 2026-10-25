import { test, expect, type Page } from '@playwright/test';

async function expectDisclosureUncovered(page: Page) {
  const pill = page.locator('.office-disclosure .demo-pill');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute('aria-label', 'Demo disclosure');
  await expect.poll(() => pill.evaluate(element => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const hit = document.elementFromPoint(x, y);
    return x >= 0 && x < innerWidth && y >= 0 && y < innerHeight && !!hit && element.contains(hit);
  })).toBe(true);
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`Demo disclosure at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('stays visible and uncovered across office views and overlays', async ({ page }) => {
      await page.goto('/office?view=overview');
      const select = page.getByLabel('Office view');
      await expect(select).toHaveValue('walk');
      await expectDisclosureUncovered(page);

      // O enters first person; O again opens the 2D map over the 3D overview.
      await page.keyboard.press('o');
      await expect(select).toHaveValue('play');
      await page.keyboard.press('o');
      const map = page.getByRole('region', { name: 'Office overview' });
      await expect(map).toBeVisible();
      await expectDisclosureUncovered(page);
      await page.keyboard.press('Escape');
      await expect(map).toHaveCount(0);

      const corner = page.getByRole('button', { name: 'Backroom menu' });
      await corner.click();
      await expect(corner).toHaveAttribute('aria-expanded', 'true');
      await expectDisclosureUncovered(page);
      await corner.click();

      await page.getByRole('button', { name: /^Office panels/ }).click();
      await expect(page.locator('#office-drawer')).toBeVisible();
      await expectDisclosureUncovered(page);
      await page.getByRole('button', { name: 'Close office panels' }).click();

      await select.selectOption({ label: 'Play (first person)' });
      await expect(page.getByRole('application', { name: /First-person office/ })).toBeFocused();
      await expectDisclosureUncovered(page);
    });
  });
}
