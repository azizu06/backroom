import { test, expect, type Page } from '@playwright/test';

// Keep browser verification local, including stylesheets that reference hosted fonts.
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return host === 'localhost' || host === '127.0.0.1' ? route.continue() : route.abort();
  });
});

// Run via test:office:browser after building the web app. Needs WebGL for the first-person Play view.
const WARNING = 'Desk kit /office-art/deskkit.glb failed to load; using the procedural props.';

function surface(page: Page) {
  return page.getByRole('application', { name: /First-person office/ });
}

async function openBaked(page: Page) {
  const warnings: string[] = [];
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?art=baked&view=overview');
  const available = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  if (!available) throw new Error('WebGL is unavailable in this headless Chromium, so the first-person Play view cannot render.');
  const viewport = page.getByTestId('office-viewport');
  await expect(viewport.locator('canvas')).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  await page.getByRole('button', { name: 'Full Floor', exact: true }).click();
  await page.getByRole('button', { name: 'Preview Treasury denial' }).click();
  await page.getByRole('button', { name: 'Close Today at Backroom' }).click();
  await expect(page.getByTestId('lobby-deny-stamp')).toContainText('DENIED · NOT_IN_BADGE');
  return { warnings, errors };
}

async function enterPlay(page: Page) {
  await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
}

test('a missing desk kit keeps the procedural audit board and stamp in Play', async ({ page }) => {
  await page.route('**/office-art/deskkit.glb', route => route.fulfill({ status: 404, body: 'missing' }));
  const { warnings, errors } = await openBaked(page);
  await expect.poll(() => warnings.some(text => text.startsWith(WARNING))).toBe(true);
  await enterPlay(page);
  const board = page.locator('[data-lobby-audit-board]');
  await expect(board).toHaveAttribute('data-lobby-audit-board', 'shown');
  await expect(page.getByTestId('lobby-deny-stamp')).toContainText('DENIED · NOT_IN_BADGE');
  // Still procedural after a beat: nothing flips once the load has already failed.
  await page.waitForTimeout(500);
  await expect(board).toHaveAttribute('data-lobby-audit-board', 'shown');
  expect(errors).toEqual([]);
});

test('a loaded desk kit retains the procedural audit board and stamp in the open office', async ({ page }) => {
  // Main retired the incompatible baked lobby shell; the kit must not bring it back.
  const lobbyRequests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/office-art/lobby.glb')) lobbyRequests.push(request.url()); });
  const { warnings, errors } = await openBaked(page);
  await expect(page.getByTestId('office-viewport').locator('canvas')).toHaveAttribute('data-deskkit', 'ready', { timeout: 30_000 });
  await enterPlay(page);
  await expect(page.locator('[data-lobby-audit-board]')).toHaveAttribute('data-lobby-audit-board', 'shown');
  await expect(page.getByTestId('lobby-deny-stamp')).toContainText('DENIED · NOT_IN_BADGE');
  expect(lobbyRequests).toEqual([]);
  expect(warnings.filter(text => text.startsWith('Desk kit'))).toEqual([]);
  expect(errors).toEqual([]);
});
