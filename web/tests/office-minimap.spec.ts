import { test, expect } from '@playwright/test';

test('Play minimap toggles with M without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office');
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await select.selectOption({ label: 'Play (first person)' });
  const minimap = page.getByRole('img', { name: /Office map/ });
  await expect(minimap).toBeVisible();
  await page.keyboard.press('m');
  await expect(minimap).toBeHidden();
  await page.keyboard.press('m');
  await expect(minimap).toBeVisible();
  expect(errors).toEqual([]);
});
