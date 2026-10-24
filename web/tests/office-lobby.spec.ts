import { test, expect, type Locator, type Page } from '@playwright/test';
import { DENY_MOMENT_MS } from '../lib/office/props/treasuryDeny';

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

test('office shows the lobby summary and agent roster without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office');
  await expect(page.getByRole('heading', { name: 'Today at Backroom' })).toBeVisible();
  await expect(page.locator('.lobby-v2-roster > li').first()).toBeVisible();
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

/** Room centres (OFFICE_ANCHORS[room].center) the focus camera targets. */
const PAYABLES = [0, -3] as const, COLLECTIONS = [-5, -3] as const;

/** Screen position of a world point under the scene's room focus camera (orthographic, target + (13, 15, 17), zoom min(w/10, h/8)). */
function projectFocus([px, py, pz]: readonly [number, number, number], width: number, height: number, [cx, cz]: readonly [number, number] = PAYABLES): [number, number] {
  const [tx, ty, tz] = [cx, 0.2, cz], zoom = Math.min(width / 10, height / 8);
  const len = Math.hypot(13, 15, 17), forward = [-13 / len, -15 / len, -17 / len] as const;
  const rightLen = Math.hypot(17, 13), right = [17 / rightLen, 0, -13 / rightLen] as const;
  const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]] as const;
  const d = [px - tx, py - ty, pz - tz] as const;
  const dot = (v: readonly number[]) => v[0]! * d[0] + v[1]! * d[1] + v[2]! * d[2];
  return [width / 2 + zoom * dot(right), height / 2 - zoom * dot(up)];
}

type Point = readonly [number, number, number];

/**
 * RGBA pixels of a 6x6 patch around each world point projected under a room's focus camera, all from one screenshot.
 * Page layout or a click can scroll the page, so scroll the canvas back into view first and fail
 * clearly if a patch is not inside both the canvas and the viewport. One screenshot per call keeps
 * sampling cheap while the scene animates, when every page round trip slows down.
 */
async function samplePatches(page: Page, canvas: Locator, points: readonly Point[], focus: readonly [number, number]): Promise<number[][]> {
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const view = page.viewportSize()!;
  const corners = points.map(point => {
    const [x, y] = projectFocus(point, box.width, box.height, focus);
    const left = Math.round(box.x + x - 3), top = Math.round(box.y + y - 3);
    const where = `world (${point.join(', ')}) -> patch (${left}, ${top}); canvas box (${box.x.toFixed(1)}, ${box.y.toFixed(1)}, ${box.width.toFixed(1)} x ${box.height.toFixed(1)}); viewport ${view.width} x ${view.height}`;
    expect(x >= 3 && y >= 3 && x <= box.width - 3 && y <= box.height - 3, `sample patch is outside the canvas: ${where}`).toBe(true);
    expect(left >= 0 && top >= 0 && left + 6 <= view.width && top + 6 <= view.height, `sample patch is outside the viewport: ${where}`).toBe(true);
    return [left, top] as const;
  });
  const left = Math.min(...corners.map(([x]) => x)), top = Math.min(...corners.map(([, y]) => y));
  const width = Math.max(...corners.map(([x]) => x)) + 6 - left, height = Math.max(...corners.map(([, y]) => y)) + 6 - top;
  const png = await page.screenshot({ clip: { x: left, y: top, width, height } });
  return page.evaluate(async ({ src, patches }) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const surface = document.createElement('canvas');
    surface.width = image.width;
    surface.height = image.height;
    const ctx = surface.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    return patches.map(([x, y]) => Array.from(ctx.getImageData(x, y, 6, 6).data));
  }, { src: `data:image/png;base64,${png.toString('base64')}`, patches: corners.map(([x, y]) => [x - left, y - top] as const) });
}

/** Mean of the darkest RGB channel in a 6x6 screenshot patch around a projected world point (0 black, 255 white). */
async function patchBrightness(page: Page, canvas: Locator, point: Point, focus: readonly [number, number] = PAYABLES): Promise<number> {
  const [data] = await samplePatches(page, canvas, [point], focus);
  let sum = 0;
  for (let i = 0; i < data!.length; i += 4) sum += Math.min(data![i]!, data![i + 1]!, data![i + 2]!);
  return sum / (data!.length / 4);
}

const TREASURY = [5, 3.4] as const;

/** How far the mean red channel of RGBA pixels stands above the other two (the DENY sign's #ed6252 is about 140). */
function redness(data: readonly number[]): number {
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += data[i + c]!;
  const n = data.length / 4;
  return (sum[0]! - Math.max(sum[1]!, sum[2]!)) / n;
}

/**
 * Red margins of the DENY sign board (centred (6.35, 1.1, 0.55), 1.6 x 0.72, facing +z), right half only:
 * clear of the 'DENIED' and rule text, whose position on screen shifts with the canvas size, and of the door ring and flash.
 */
const SIGN_MARGINS = [[6.95, 0.84, 0.56], [7.0, 1.38, 0.56], [6.7, 0.82, 0.56], [6.95, 1.1, 0.56]] as const;

/** Redness at every sign margin point under the Treasury focus camera. */
async function signRedness(page: Page, canvas: Locator): Promise<number[]> {
  return (await samplePatches(page, canvas, SIGN_MARGINS, TREASURY)).map(redness);
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

test('office desk monitors survive the Collections escalation preview', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
  await page.goto('/office');
  const viewport = page.getByTestId('office-viewport');
  const canvas = viewport.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview escalation' }).click();
  await expect(page.getByRole('button', { name: 'Return to Collections' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: 'Collections', exact: true }).click();
  // Once the focus camera settles, the empty right strip of the Collections screen shows the panel's #1d2420 (min channel 29),
  // not the bright accent face (#a9bc8f) behind it, while the lit desk top beside it stays bright.
  await expect.poll(() => patchBrightness(page, canvas, [-5.6, 0.912, -2.65], COLLECTIONS), { timeout: 10_000 }).toBeGreaterThan(120);
  await expect.poll(() => patchBrightness(page, canvas, [-5.074, 1.135, -3.171], COLLECTIONS), { timeout: 10_000 }).toBeLessThan(60);
  await expect(page.getByText(/3D unavailable/).filter({ visible: true })).toHaveCount(0);
  await expect(viewport.locator('.floor-plan')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('office ambience renders a still scene under reduced motion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/office');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const viewport = page.getByTestId('office-viewport');
  const canvas = viewport.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  // With the ambient ticker off, the static pose still has to reach the screen: the focused Payables board draws.
  await page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: 'Payables', exact: true }).click();
  await expect.poll(() => patchBrightness(page, canvas, [1.74, 1.47, -5.349]), { timeout: 10_000 }).toBeGreaterThan(170);
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

test('office Treasury denial preview plays the door moment without breaking the scene', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
  await page.goto('/office');
  const viewport = page.getByTestId('office-viewport');
  const canvas = viewport.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  const treasury = page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: /^Treasury/ });
  await treasury.click();
  await expect(treasury).toHaveAttribute('aria-pressed', 'true');
  // The margin points must fit the focus view for both the lobby's canvas (1440 x 580) and a taller one (1440 x 1000).
  for (const [width, height] of [[1440, 580], [1440, 1000]] as const) {
    for (const point of SIGN_MARGINS) {
      const [x, y] = projectFocus(point, width, height, TREASURY);
      expect(x >= 3 && y >= 3 && x <= width - 3 && y <= height - 3, `sign point (${point.join(', ')}) projects to (${x.toFixed(1)}, ${y.toFixed(1)}), outside a ${width} x ${height} canvas`).toBe(true);
    }
  }
  // Let the focus camera settle: no sign margin point is red before the denial.
  await page.waitForTimeout(2500);
  const before = await signRedness(page, canvas);
  expect(Math.max(...before), `redness before the preview: ${before.join(', ')}`).toBeLessThan(40);
  await page.getByRole('button', { name: 'Preview Treasury denial' }).click();
  // The preview button sits below the scene, so clicking it can scroll the canvas out of view.
  await canvas.scrollIntoViewIfNeeded();
  // Poll rather than sample at a fixed time: under load the first frame of the moment can land late.
  const maxRedness = async () => Math.max(...await signRedness(page, canvas));
  await expect.poll(maxRedness, { message: 'max sign redness during the moment', timeout: DENY_MOMENT_MS - 500, intervals: [100] }).toBeGreaterThan(80);
  await expect.poll(maxRedness, { message: 'max sign redness after the moment', timeout: DENY_MOMENT_MS + 4000 }).toBeLessThan(40);
  // The 3D ViewBoundary swallows render errors into its floor-plan fallback, so assert it never appeared.
  await expect(page.getByText(/3D unavailable/).filter({ visible: true })).toHaveCount(0);
  await expect(viewport.locator('.floor-plan')).toHaveCount(0);
  await page.getByLabel('Office view').selectOption('plan');
  await expect(page.locator('.floor-plan .denial-text')).toHaveText('Entry denied');
  expect(errors).toEqual([]);
});
