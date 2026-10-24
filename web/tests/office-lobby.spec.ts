import { test, expect, type Locator, type Page } from '@playwright/test';

// Run via test:office:browser after building the web app.
const code = process.env.OFFICE_LOBBY_OPERATOR_CODE ?? 'local-audit-test-only';
if (process.env.OFFICE_LOBBY_URL) test.use({ baseURL: process.env.OFFICE_LOBBY_URL });

test('office lobby mounts the live audit wall and ask-why without breaking the office layout', async ({ page }) => {
  const errors: string[] = [], audit: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/audit/')) audit.push(path); });
  await page.goto('/office');
  await expect(page.locator('.office-toolbar')).toBeVisible();
  await expect(page.getByTestId('office-viewport')).toBeVisible();
  const lobby = page.locator('#office-audit-wall');
  await expect(lobby).toHaveAttribute('data-office-mount', 'audit-wall');
  await expect(lobby.locator('[data-audit-id]')).toHaveCount(0);
  await expect(lobby).not.toContainText('Preview receipts');
  await lobby.getByLabel('Operator code').fill(code);
  await lobby.getByRole('button', { name: 'Open audit wall' }).click();
  await expect(lobby.getByText(/^Chain verified · \d+ entries$/)).toBeVisible();
  expect(audit).toContain('/api/audit/entries');
  await expect(lobby.getByRole('heading', { name: 'Audit wall', exact: true, level: 3 })).toBeVisible();
  await expect(lobby.locator('.audit-why')).toHaveCount(0);
  const ask = lobby.getByRole('region', { name: 'Ask why by voice' });
  await expect(ask.getByRole('button', { name: 'Hold to ask why' })).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Ask why', exact: true })).toBeDisabled();
  // The full-page wall is constrained inside the footer, left of the RealVsSim panel spacing.
  const viewport = await page.getByTestId('office-viewport').boundingBox();
  const wall = await lobby.locator('.audit-wall').boundingBox();
  const footer = await page.locator('.office-footer').boundingBox();
  expect(viewport!.height).toBeGreaterThan(400);
  expect(wall!.height).toBeLessThanOrEqual(900);
  expect(wall!.x + wall!.width).toBeLessThanOrEqual(footer!.x + footer!.width - 680);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Preview Treasury denial' }).click();
  const previewReceipts = page.getByRole('region', { name: 'Preview audit receipts' });
  await expect(previewReceipts).toContainText('DENY');
  // Fixture rows stay out of the server-record lobby wall (its own rows may carry data-audit-id).
  const denialId = await previewReceipts.locator('[data-audit-id]').first().getAttribute('data-audit-id');
  await expect(lobby.locator(`[data-audit-id="${denialId}"]`)).toHaveCount(0);
  await expect(lobby).not.toContainText('Preview receipts');
  expect(errors).toEqual([]);
});

test('office ask-why pauses on a broken chain and resumes when verified', async ({ page }) => {
  let valid = false;
  await page.route('**/api/audit/entries', route => route.fulfill({ json: {
    entries: [], chain: { valid, length: 0, ...(valid ? {} : { firstBrokenSeq: 1, reason: 'hash mismatch' }) },
    measuredAt: '2026-10-24T12:00:00Z',
  } }));
  await page.goto('/office');
  const lobby = page.locator('#office-audit-wall');
  const ask = lobby.getByRole('region', { name: 'Ask why by voice' });
  await expect(ask).toContainText('The audit chain is broken');
  await expect(ask.getByRole('button', { name: 'Hold to ask why' })).toBeDisabled();
  await expect(ask.getByRole('textbox')).toBeDisabled();
  await expect(ask.getByRole('button', { name: 'Ask why', exact: true })).toBeDisabled();
  await expect(lobby.locator('.audit-why')).toHaveCount(0);
  valid = true;
  await expect(ask.getByRole('button', { name: 'Hold to ask why' })).toBeEnabled();
  await expect(ask.getByRole('textbox')).toBeEnabled();
  await expect(ask).not.toContainText('The audit chain is broken');
  await page.route('**/api/why', route => route.fulfill({ status: 409, json: { error: 'AUDIT_CHAIN_BROKEN' } }));
  await ask.getByRole('textbox').fill('Why was payment paused?');
  await ask.getByRole('button', { name: 'Ask why', exact: true }).click();
  await expect(ask.getByRole('alert')).toContainText('The audit chain is broken');
  await expect(ask.getByRole('alert')).toContainText('AUDIT_CHAIN_BROKEN');
});

/** Screen position of a world point under the scene's Payables focus camera (orthographic, target + (13, 15, 17), zoom min(w/10, h/8)). */
function projectPayablesFocus([px, py, pz]: readonly [number, number, number], width: number, height: number): [number, number] {
  const [tx, ty, tz] = [0, 0.2, -3], zoom = Math.min(width / 10, height / 8);
  const len = Math.hypot(13, 15, 17), forward = [-13 / len, -15 / len, -17 / len] as const;
  const rightLen = Math.hypot(17, 13), right = [17 / rightLen, 0, -13 / rightLen] as const;
  const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]] as const;
  const d = [px - tx, py - ty, pz - tz] as const;
  const dot = (v: readonly number[]) => v[0]! * d[0] + v[1]! * d[1] + v[2]! * d[2];
  return [width / 2 + zoom * dot(right), height / 2 - zoom * dot(up)];
}

/** Mean of the darkest RGB channel in a 6x6 screenshot patch around a projected world point (0 black, 255 white). */
async function patchBrightness(page: Page, canvas: Locator, point: readonly [number, number, number]): Promise<number> {
  const box = (await canvas.boundingBox())!;
  const [x, y] = projectPayablesFocus(point, box.width, box.height);
  const png = await page.screenshot({ clip: { x: box.x + x - 3, y: box.y + y - 3, width: 6, height: 6 } });
  return page.evaluate(async src => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
    return sum / (data.length / 4);
  }, `data:image/png;base64,${png.toString('base64')}`);
}

test('office props render in the 3D scene', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Network status noise (e.g. the unauthenticated LLM switch probe) is not a render failure.
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
  await page.goto('/office');
  const viewport = page.getByTestId('office-viewport');
  const canvas = viewport.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: 'Payables', exact: true }).click();
  // A blank part of the board (right of the empty-audit note) turns cream once the focus camera settles; just above it is background.
  await expect.poll(() => patchBrightness(page, canvas, [1.74, 1.47, -5.349]), { timeout: 10_000 }).toBeGreaterThan(170);
  expect(await patchBrightness(page, canvas, [1.74, 3.3, -5.349])).toBeLessThan(90);
  // The 3D ViewBoundary swallows render errors into its floor-plan fallback, so assert it never appeared.
  // (The Canvas keeps a hidden '3D unavailable' fallback inside <canvas>; only a visible one means failure.)
  await expect(page.getByText(/3D unavailable/).filter({ visible: true })).toHaveCount(0);
  await expect(viewport.locator('.floor-plan')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('office judge tour visits the rooms with agent tags and stops on any key', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office');
  await expect(page.locator('canvas')).toBeVisible();
  // The preview fixture seats three agents; each gets one tag.
  await expect(page.locator('.seat-statuses > div')).toHaveCount(3);
  await expect(page.locator('[data-agent-tag]')).toHaveCount(3);
  const view = page.getByLabel('Office view');
  const caption = page.locator('.office-caption');
  await view.selectOption('tour');
  await expect(caption).toContainText('Tour');
  await expect(page.getByRole('button', { name: 'Stop tour', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: 'Lobby', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift');
  await expect(view).toHaveValue('tween');
  await expect(caption).not.toContainText('Tour');
  await expect(page.getByRole('button', { name: 'Stop tour', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('office judge tour advances under reduced motion and stops on a click', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/office');
  await expect(page.locator('canvas')).toBeVisible();
  const view = page.getByLabel('Office view');
  const caption = page.locator('.office-caption');
  await view.selectOption('tour');
  await expect(caption).toContainText('Tour · 1 of');
  await expect(caption).toContainText('Tour · 2 of', { timeout: 8000 });
  const box = await page.getByTestId('office-viewport').boundingBox();
  await page.mouse.click(box!.x + 8, box!.y + 8);
  await expect(view).toHaveValue('tween');
  await expect(caption).not.toContainText('Tour');
  expect(errors).toEqual([]);
});

test('office judge tour is not cancelled by the view select navigation keys', async ({ page }) => {
  // Portable: dispatch the keydown on the select itself, so no platform-specific native-select behaviour is involved.
  await page.goto('/office');
  await expect(page.locator('canvas')).toBeVisible();
  const view = page.getByLabel('Office view');
  const caption = page.locator('.office-caption');
  await view.selectOption('tour');
  await expect(caption).toContainText('Tour · 1 of');
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown']) await view.dispatchEvent('keydown', { key });
  await expect(view).toHaveValue('tour');
  await expect(caption).toContainText('Tour');
  // Any other key on the select still ends the tour.
  await view.focus();
  await page.keyboard.press('Tab');
  await expect(view).toHaveValue('tween');
  await expect(caption).not.toContainText('Tour');
});

test('office judge tour started with the native select arrow keys', async ({ page, browserName }) => {
  // A closed <select> changes value on ArrowDown/ArrowUp in Linux/Windows Chromium; macOS opens the popup instead.
  test.skip(process.platform === 'darwin' || browserName !== 'chromium', 'native select arrow-key navigation is platform-specific');
  await page.goto('/office');
  await expect(page.locator('canvas')).toBeVisible();
  const view = page.getByLabel('Office view');
  const caption = page.locator('.office-caption');
  await view.selectOption('plan');
  await view.focus();
  await page.keyboard.press('ArrowDown');
  await expect(view).toHaveValue('tour');
  await page.waitForTimeout(500);
  await expect(caption).toContainText('Tour · 1 of');
  await page.keyboard.press('ArrowUp');
  await expect(view).toHaveValue('plan');
  await expect(page.getByLabel('2D office floor plan')).toBeVisible();
  await view.focus();
  await page.keyboard.press('ArrowDown');
  await expect(view).toHaveValue('tour');
  await page.keyboard.press('Tab');
  await expect(view).toHaveValue('tween');
});
