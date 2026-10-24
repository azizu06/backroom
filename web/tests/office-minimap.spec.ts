import { test, expect } from '@playwright/test';

test('Play minimap toggles with M without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
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

test('Play minimap can be hidden and restored by touch button and persists after reload', async ({ page }) => {
  await page.goto('/office?view=overview');
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await select.selectOption({ label: 'Play (first person)' });

  const minimap = page.getByRole('img', { name: /Office map/ });
  const toggle = page.getByRole('button', { name: 'Hide map' });
  await expect(minimap).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(minimap).toBeHidden();
  const show = page.getByRole('button', { name: 'Show map' });
  await expect(show).toHaveAttribute('aria-pressed', 'false');
  await show.click();
  await expect(minimap).toBeVisible();

  await page.reload();
  const reloadedSelect = page.getByLabel('Office view');
  await expect(reloadedSelect).toHaveValue('walk');
  await reloadedSelect.selectOption({ label: 'Play (first person)' });
  await expect(page.getByRole('img', { name: /Office map/ })).toBeVisible();
});
