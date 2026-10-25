import { test, expect, type Page } from '@playwright/test';
import { openMenu, openSheet } from './office-menu';

// O toggles first person; in Play, O opens the 2D overview map. Room inspector replaces the old corner quick-menu.
function surface(page: Page) {
  return page.getByRole('application', { name: /First-person office/ });
}

async function openOverview(page: Page, errors: string[]) {
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await openMenu(page);
}

test('O toggles first person and the Play button does the same', async ({ page }) => {
  const errors: string[] = [];
  await openOverview(page, errors);
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await page.keyboard.press('o');
  await expect(surface(page)).toBeFocused();
  await expect(select).toHaveValue('play');
  // O in first person opens the Overview map.
  await page.keyboard.press('o');
  await expect(surface(page)).toHaveCount(0);
  await expect(select).toHaveValue('walk');
  const map = page.getByRole('region', { name: 'Office overview' });
  await expect(map).toBeVisible();
  await expect(map.locator('.overview-map-room')).toHaveCount(6);
  await expect(map.locator('.overview-map-agent')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(map).toHaveCount(0);
  await expect(select).toHaveValue('walk');
  await openMenu(page);
  await page.getByRole('button', { name: 'Play (First Person)', exact: true }).click();
  await expect(surface(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(surface(page)).toHaveCount(0);
  // Typing O into a field never toggles.
  await select.focus();
  await page.keyboard.press('o');
  await expect(surface(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Rooms sheet focuses a room and opens its inspector', async ({ page }) => {
  const errors: string[] = [];
  await openOverview(page, errors);
  await openSheet(page, 'rooms');
  await page.getByRole('button', { name: /^Payables/ }).click();
  const inspector = page.locator('.room-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Payables');
  expect(errors).toEqual([]);
});

test('O leaves the view unchanged while keyboard shortcuts has focus', async ({ page }) => {
  await page.goto('/office?view=overview');
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('office-viewport').getByText('Loading 3D office…')).toHaveCount(0);
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await expect(help.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('o');
  await expect(help).toBeVisible();
  await expect(select).toHaveValue('walk');
  await expect(page.getByRole('application', { name: /First-person office/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(help).not.toBeVisible();
  await page.keyboard.press('o');
  await expect(select).toHaveValue('play');
});
