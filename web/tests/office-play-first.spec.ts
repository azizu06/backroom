import { test, expect, type Page } from '@playwright/test';

// Run via test:office:browser after building the web app. Play needs WebGL.
const surface = (page: Page) => page.getByRole('application', { name: /First-person office/ });
const splash = (page: Page) => page.getByRole('dialog', { name: 'Backroom' });

test('/office opens on the Enter the office splash and Enter starts first person', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office');
  const gate = splash(page);
  await expect(gate).toBeVisible();
  await expect(gate.getByRole('heading', { name: 'Backroom' })).toBeVisible();
  await expect(gate).toContainText('Enter the office');
  for (const control of ['WASD / arrows', 'Mouse or drag', 'interact', 'map', 'Esc']) await expect(gate).toContainText(control);
  await expect(gate.getByRole('button', { name: 'Overview (map view)' })).toBeVisible();
  await gate.getByRole('button', { name: 'Enter', exact: true }).click();
  await expect(gate).toHaveCount(0);
  await expect(surface(page)).toBeFocused();
  await expect(page.getByLabel('Office view')).toHaveValue('play');
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
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

test('Tab three times stays in the splash, Escape closes it, and focus returns to the opener', async ({ page }) => {
  // Focus a real control before hydration so the splash's opener is the view select, not the body.
  await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      document.getElementById('office-view')?.focus();
    });
  });
  await page.goto('/office');
  const gate = splash(page);
  const enter = gate.getByRole('button', { name: 'Enter', exact: true });
  const overview = gate.getByRole('button', { name: 'Overview (map view)' });
  await expect(enter).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(overview).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(enter).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(overview).toBeFocused();
  await expect(gate.locator(':focus')).toHaveCount(1);
  const story = page.getByRole('button', { name: 'Story mode' });
  await expect(page.locator('.office-shell > header')).toHaveAttribute('inert', '');
  const blocked = await story.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    el.focus();
    return { covered: hit !== el && !el.contains(hit), focused: document.activeElement === el, inert: el.closest('[inert]') !== null };
  });
  expect(blocked).toEqual({ covered: true, focused: false, inert: true });
  await page.keyboard.press('Escape');
  await expect(gate).toHaveCount(0);
  await expect(page.getByLabel('Office view')).toHaveValue('walk');
  await expect(page.getByLabel('Office view')).toBeFocused();
});

test('the splash traps Tab at both ends and Escape still opens the overview', async ({ page }) => {
  await page.goto('/office');
  const gate = splash(page);
  const enter = gate.getByRole('button', { name: 'Enter', exact: true });
  const overview = gate.getByRole('button', { name: 'Overview (map view)' });
  await expect(enter).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(overview).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(enter).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(overview).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(enter).toBeFocused();
  // Focus that already escaped is pulled back in by the next Tab.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  await expect(gate.locator(':focus')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(gate).toHaveCount(0);
  await expect(page.getByLabel('Office view')).toHaveValue('walk');
});

test('choosing the overview is remembered for the next visit', async ({ page }) => {
  await page.goto('/office');
  await splash(page).getByRole('button', { name: 'Overview (map view)' }).click();
  await expect(splash(page)).toHaveCount(0);
  await expect(page.getByLabel('Office view')).toHaveValue('walk');
  expect(await page.evaluate(() => localStorage.getItem('office.start'))).toBe('overview');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Enter first person' })).toBeVisible();
  await expect(splash(page)).toHaveCount(0);
});

test('?view=overview shows no splash and offers Enter first person', async ({ page }) => {
  await page.goto('/office?view=overview');
  const enter = page.getByRole('button', { name: 'Enter first person' });
  await expect(enter).toBeVisible();
  await expect(splash(page)).toHaveCount(0);
  await expect(page.getByLabel('Office view')).toHaveValue('walk');
  await enter.click();
  await expect(surface(page)).toBeFocused();
  await expect(enter).toHaveCount(0);
  // The Enter click asked for pointer lock, which routes mouse clicks to the surface: activate by keyboard.
  await page.getByRole('button', { name: 'Overview', exact: true }).press('Enter');
  await expect(page.getByLabel('Office view')).toHaveValue('walk');
  await expect(page.getByRole('button', { name: 'Enter first person' })).toBeVisible();
});

test('the splash does not animate with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/office');
  await expect(splash(page)).toBeVisible();
  expect(await splash(page).evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('starts in the overview with an Enter first person button', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/office');
    const enter = page.getByRole('button', { name: 'Enter first person' });
    await expect(enter).toBeVisible();
    await expect(splash(page)).toHaveCount(0);
    await expect(page.getByLabel('Office view')).not.toHaveValue('play');
    await enter.click();
    await expect(surface(page)).toBeVisible();
    await expect(page.locator('.play-joystick')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
