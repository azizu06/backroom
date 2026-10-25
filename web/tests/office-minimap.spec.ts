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

test.describe('Overview touch control', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('opens Overview from first person by touch', async ({ page }) => {
    await page.goto('/office?view=overview');
    const select = page.getByLabel('Office view');
    await select.selectOption({ label: 'Play (first person)' });
    await expect(page.getByRole('application', { name: /First-person office/ })).toBeFocused();
    await page.getByRole('button', { name: /^Overview/ }).tap();
    // At 390px the overview keeps the fixed camera it started with (Office.tsx prefers orbit only above 760px).
    await expect(select).toHaveValue('tween');
    await expect(page.getByRole('region', { name: 'Office overview' })).toBeVisible();
    await expect(page.getByRole('application', { name: /First-person office/ })).toHaveCount(0);
  });
});
