import { test, expect } from '@playwright/test';

const navLinks = [
  ['Office', '/office'],
  ['Inbox', '/inbox'],
  ['Audit wall', '/audit'],
  ['Attack demo', '/attack'],
  ['Real vs simulated', '/real-vs-sim'],
  ['Operator', '/operator'],
  ['Controller', '/controller'],
] as const;

test('judge start page links to the office story and shared navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/start');
  await expect(page).toHaveTitle('Start · Backroom');
  await expect(page.getByRole('heading', { level: 1, name: 'Backroom: start here' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Story mode', exact: true })).toHaveAttribute('href', '/office?demo=story');
  const escalation = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Visual escalation preview' }) });
  await expect(escalation.getByRole('link', { name: 'Visual escalation preview', exact: true })).toHaveAttribute('href', '/office');
  await expect(escalation).toContainText('visual fixture');
  await expect(escalation).toContainText('seeded approval');
  await expect(escalation.getByRole('link', { name: 'inbox', exact: true })).toHaveAttribute('href', '/inbox');
  const nav = page.getByRole('navigation', { name: 'Site', exact: true });
  for (const [name, href] of navLinks) await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  await nav.getByRole('link', { name: 'Audit wall', exact: true }).click();
  await expect(page).toHaveURL('/audit');
  await expect(nav.getByRole('link', { name: 'Audit wall', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Office', exact: true })).not.toHaveAttribute('aria-current', 'page');
  expect(errors).toEqual([]);
});

test('story card opens a running judge story', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/start');
  await page.getByRole('link', { name: 'Story mode', exact: true }).click();
  await expect(page).toHaveURL('/office?demo=story');
  await expect(page.getByRole('complementary', { name: 'Judge story mode' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('office overview keeps one site bar in the header, off the canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office');
  const nav = page.getByRole('navigation', { name: 'Site', exact: true });
  await expect(nav).toHaveCount(1);
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Office', exact: true })).toHaveAttribute('aria-current', 'page');
  const header = page.locator('.office-header');
  await expect(header).toContainText('Office');
  const navBox = await nav.boundingBox();
  const canvasBox = await page.getByTestId('office-viewport').boundingBox();
  expect(navBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(navBox!.y + navBox!.height).toBeLessThanOrEqual(canvasBox!.y + 1);
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
  await page.goto('/office?embed=1');
  await expect(page.getByTestId('office-viewport')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Site', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
