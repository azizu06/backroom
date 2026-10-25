import { test, expect, type Page } from '@playwright/test';

// Run via test:office:browser after building the web app. Needs WebGL for the first-person Play view.
const WARNING = 'Baked art /office-art/lobby.glb failed to load; using the procedural scene.';

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
  // Preview controls sit in the corner menu (closed by default); a pick closes it again.
  await page.getByRole('button', { name: 'Backroom menu' }).click();
  await page.getByRole('button', { name: 'Show Treasury denial' }).click();
  await expect(page.getByTestId('lobby-deny-stamp')).toContainText('DENIED · NOT_IN_BADGE');
  return { warnings, errors };
}

async function enterPlay(page: Page) {
  await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/, { timeout: 15_000 });
}

test('a missing baked lobby keeps the procedural audit board, stamp and colliders in Play', async ({ page }) => {
  await page.route('**/office-art/lobby.glb', route => route.fulfill({ status: 404, body: 'missing' }));
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

test('a loaded baked lobby replaces the procedural audit board and stamp in Play', async ({ page }) => {
  const loaded = page.waitForResponse(response => response.url().endsWith('/office-art/lobby.glb') && response.ok());
  const { warnings, errors } = await openBaked(page);
  await loaded;
  await enterPlay(page);
  await expect(page.locator('[data-lobby-audit-board]')).toHaveAttribute('data-lobby-audit-board', 'baked');
  await expect(page.getByTestId('lobby-deny-stamp')).toHaveCount(0);
  expect(warnings.filter(text => text.startsWith('Baked art'))).toEqual([]);
  expect(errors).toEqual([]);
});
