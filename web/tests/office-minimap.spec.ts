import { test, expect, type Page } from '@playwright/test';

const surface = (page: Page) => page.getByRole('application', { name: /First-person office/ });

test('Play minimap toggles with M without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
  await surface(page).focus();
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
  await expect(surface(page)).toBeVisible();

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
  await expect(surface(page)).toBeVisible();
  await expect(page.getByRole('img', { name: /Office map/ })).toBeVisible();
});
