import { test, expect } from '@playwright/test';

test('judge start page links to the office story and shared audit navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/start');
  await expect(page).toHaveTitle('Start · Backroom');
  await expect(page.getByRole('heading', { level: 1, name: 'Backroom: start here' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Story mode', exact: true })).toHaveAttribute('href', '/office?demo=story');
  const nav = page.getByRole('navigation', { name: 'Site', exact: true });
  await nav.getByRole('link', { name: 'Audit', exact: true }).click();
  await expect(page).toHaveURL('/audit');
  await expect(nav.getByRole('link', { name: 'Audit', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Office', exact: true })).not.toHaveAttribute('aria-current', 'page');
  expect(errors).toEqual([]);
});

test('site navigation is hidden in embeds and on customer payment routes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/start?embed=1');
  await expect(page.getByRole('heading', { name: 'Backroom: start here' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Site', exact: true })).toHaveCount(0);
  // Customer payment pages stay unbranded by our internal nav, whatever the link's state.
  await page.goto('/pay/missing-link');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Site', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
