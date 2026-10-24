import { test, expect, type Page } from '@playwright/test';

// Run via test:office:browser after building the web app. Play needs WebGL.
const surface = (page: Page) => page.getByRole('application', { name: /First-person office/ });
const splash = (page: Page) => page.getByRole('dialog', { name: 'Backroom' });
const textView = (page: Page) => page.locator('#office-text-view');

test('/office opens on the Enter the office splash and Enter starts first person', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office');
  const gate = splash(page);
  await expect(gate).toBeVisible();
  await expect(gate.getByRole('heading', { name: 'Backroom' })).toBeVisible();
  await expect(gate).toContainText('Enter the office');
  for (const control of ['WASD / arrows', 'Mouse or drag', 'interact', 'map', 'Esc']) await expect(gate).toContainText(control);
  await expect(gate.getByRole('button', { name: 'Text view (no 3D)' })).toBeVisible();
  // First person is the only view: there is no view menu to pick another camera.
  await expect(page.getByLabel('Office view')).toHaveCount(0);
  await gate.getByRole('button', { name: 'Enter', exact: true }).click();
  await expect(gate).toHaveCount(0);
  await expect(surface(page)).toBeFocused();
  await expect(page.getByRole('button', { name: 'Text view', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('office.start'))).toBe('play');
  expect(errors).toEqual([]);
});

test('the Enter key starts first person from the splash', async ({ page }) => {
  await page.goto('/office');
  await expect(splash(page)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(splash(page)).toHaveCount(0);
  await expect(surface(page)).toBeFocused();
});

test('choosing the text view focuses it and is remembered for the next visit', async ({ page }) => {
  await page.goto('/office');
  await splash(page).getByRole('button', { name: 'Text view (no 3D)' }).click();
  await expect(splash(page)).toHaveCount(0);
  await expect(textView(page)).toBeFocused();
  await expect(surface(page)).not.toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('office.start'))).toBe('overview');
  await page.reload();
  await expect(splash(page)).toHaveCount(0);
  await expect(surface(page)).toBeVisible();
});

test('Escape and the HUD button leave first person for the text view, and the way back is by keyboard', async ({ page }) => {
  await page.goto('/office?view=overview');
  await expect(splash(page)).toHaveCount(0);
  await expect(surface(page)).toBeVisible();
  await surface(page).focus();
  await page.keyboard.press('Escape');
  await expect(textView(page)).toBeFocused();
  await textView(page).getByRole('button', { name: 'Back to first person' }).press('Enter');
  await expect(surface(page)).toBeFocused();
  await page.getByRole('button', { name: 'Text view', exact: true }).press('Enter');
  await expect(textView(page)).toBeFocused();
  // The toolbar link reaches the same text view from anywhere.
  await page.getByRole('link', { name: 'Text view' }).press('Enter');
  await expect(textView(page)).toBeFocused();
  await expect(textView(page).locator('.seat-statuses > div').first()).toBeVisible();
});

test('the splash does not animate with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/office');
  await expect(splash(page)).toBeVisible();
  expect(await splash(page).evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('starts in touch first person without the splash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/office');
    await expect(splash(page)).toHaveCount(0);
    await expect(surface(page)).toBeVisible();
    await expect(page.locator('.play-joystick')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
