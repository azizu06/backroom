import { test, expect } from '@playwright/test';

// Diegetic HUD (variant c): the corner minimap gives way to the 3D Overview (O), which shows the whole floor.
test('Play keeps the corner map out of view and offers the Overview instead, without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office');
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await select.selectOption({ label: 'Play (first person)' });
  await expect(page.getByRole('application', { name: /First-person office/ })).toBeFocused();
  const minimap = page.getByRole('img', { name: /Office map/ });
  await expect(minimap).toBeHidden();
  await page.keyboard.press('m');
  await expect(minimap).toBeHidden();
  await page.keyboard.press('o');
  await expect(select).toHaveValue('walk');
  await expect(page.getByRole('region', { name: 'Office overview' })).toBeVisible();
  expect(errors).toEqual([]);
});

// The corner map's touch toggle is hidden with the map in the diegetic HUD; its preference logic stays unit-tested (minimap.test.ts).
test.skip('Play minimap can be hidden and restored by touch button and persists after reload', async ({ page }) => {
  await page.goto('/office');
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
