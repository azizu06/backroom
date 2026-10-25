import { test, expect, type Locator, type Page } from '@playwright/test';
import { openMenu, openPanels } from './office-menu';
import { DENY_MOMENT_MS } from '../lib/office/props/treasuryDeny';
import { ROLES } from '../lib/office/palette';

// Run via test:office:browser after building the web app.

async function preset(page: Page, name: string | RegExp) {
  await openMenu(page);
  // A CSS locator: a pick closes the menu, and role queries skip the closed (hidden) panel.
  return page.locator('.room-navigation button').filter({ hasText: typeof name === 'string' ? new RegExp(`^${name}$`) : name });
}
const code = process.env.OFFICE_LOBBY_OPERATOR_CODE ?? 'local-audit-test-only';
if (process.env.OFFICE_LOBBY_URL) test.use({ baseURL: process.env.OFFICE_LOBBY_URL });

test('office lobby mounts the live audit wall and ask-why without breaking the office layout', async ({ page }) => {
  const errors: string[] = [], audit: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/audit/')) audit.push(path); });
  await page.goto('/office?view=overview');
  await expect(page.locator('.office-toolbar')).toBeVisible();
  await expect(page.getByTestId('office-viewport')).toBeVisible();
  // The world fills the window: nothing stacked above or below the canvas, and the panels drawer starts closed.
  const box = await page.getByTestId('office-viewport').boundingBox();
  const size = page.viewportSize()!;
  expect(box).toEqual({ x: 0, y: 0, width: size.width, height: size.height });
  await expect(page.locator('#office-drawer')).toBeHidden();
  await openPanels(page);
  const lobby = page.locator('#office-audit-wall');
  await expect(lobby).toHaveAttribute('data-office-mount', 'audit-wall');
  await expect(lobby.locator('[data-audit-id]')).toHaveCount(0);
  await expect(lobby).not.toContainText('Walkthrough receipts');
  await lobby.getByLabel('Operator code').fill(code);
  await lobby.getByRole('button', { name: 'Open audit wall' }).click();
  await expect(lobby.getByText(/^Chain verified · \d+ entries$/)).toBeVisible();
  expect(audit).toContain('/api/audit/entries');
  await expect(lobby.getByRole('heading', { name: 'Audit wall', exact: true, level: 3 })).toBeVisible();
  await expect(lobby.locator('.audit-why')).toHaveCount(0);
  const ask = lobby.getByRole('region', { name: 'Ask why by voice' });
  await expect(ask.getByRole('button', { name: 'Hold to ask why' })).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Ask why', exact: true })).toBeDisabled();
  // The full-page wall is constrained inside the panels drawer.
  const wall = await lobby.locator('.audit-wall').boundingBox();
  const drawer = await page.locator('#office-drawer').boundingBox();
  expect(wall!.x).toBeGreaterThanOrEqual(drawer!.x);
  expect(wall!.x + wall!.width).toBeLessThanOrEqual(drawer!.x + drawer!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await openMenu(page);
  await page.getByRole('button', { name: 'Show Treasury denial' }).click();
  const previewReceipts = page.getByRole('region', { name: 'Local audit receipts' });
  await expect(previewReceipts).toContainText('DENY');
  // Fixture rows stay out of the server-record lobby wall (its own rows may carry data-audit-id).
  const denialId = await previewReceipts.locator('[data-audit-id]').first().getAttribute('data-audit-id');
  await expect(lobby.locator(`[data-audit-id="${denialId}"]`)).toHaveCount(0);
  await expect(lobby).not.toContainText('Walkthrough receipts');
  expect(errors).toEqual([]);
});

test('office demo guide and keyboard shortcuts help open and restore focus', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
  await openMenu(page);
  const guideButton = page.getByRole('button', { name: 'Guide', exact: true });
  await guideButton.click();
  const guide = page.getByRole('dialog', { name: 'Try this' });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('Treasury');
  await page.keyboard.press('Escape');
  await expect(guide).toHaveCount(0);
  await expect(guideButton).toBeFocused();
  await guideButton.focus();
  await page.keyboard.press('?');
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts).toContainText('Interact');
  // Native modal dialogs keep sequential focus inside while the background is inert.
  const close = shortcuts.getByRole('button', { name: 'Close' });
  for (let index = 0; index < 3; index++) {
    await page.keyboard.press('Tab');
    await expect(shortcuts).toContainText('Keyboard shortcuts');
    await expect(shortcuts).toContainText('Interact');
    expect(await page.evaluate(() => document.activeElement?.closest('dialog')?.classList.contains('office-shortcuts'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(shortcuts).toHaveCount(0);
  await expect(guideButton).toBeFocused();
  await openMenu(page);
  await page.getByLabel('Office view').selectOption('play');
  await page.locator('.play-surface').press('?');
  await expect(shortcuts).toBeVisible();
  for (let index = 0; index < 3; index++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('dialog')?.classList.contains('office-shortcuts'))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(shortcuts).toHaveCount(0);
  await expect(page.locator('.play-surface')).toBeFocused();
  expect(errors).toEqual([]);
});

test('office shows the lobby summary and agent roster without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
  await openPanels(page);
  await expect(page.getByRole('heading', { name: 'Today at Backroom' })).toBeVisible();
  // Diegetic HUD: the seat status row is the one roster (the lobby strip keeps today's counts and the feed).
  await expect(page.locator('.seat-statuses > div').first()).toBeVisible();
  await expect(page.locator('.lobby-v2-roster')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('office ask-why pauses on a broken chain and resumes when verified', async ({ page }) => {
  await page.route('**/api/audit/session', route => route.fulfill({ json: { signedIn: true } }));
  let valid = false;
  await page.route('**/api/audit/entries', route => route.fulfill({ json: {
    entries: [], chain: { valid, length: 0, ...(valid ? {} : { firstBrokenSeq: 1, reason: 'hash mismatch' }) },
    measuredAt: '2026-10-24T12:00:00Z',
  } }));
  await page.goto('/office?view=overview');
  await openPanels(page);
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
const PAYABLES = [-3.5, -5] as const, COLLECTIONS = [-9, -5] as const;

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

/** Mean RGB of a 6x6 screenshot patch around a projected world point. */
async function patchColor(page: Page, canvas: Locator, point: Point, focus: readonly [number, number] = PAYABLES): Promise<number[]> {
  const [data] = await samplePatches(page, canvas, [point], focus);
  return [0, 1, 2].map(c => { let sum = 0; for (let i = c; i < data!.length; i += 4) sum += data![i]!; return sum / (data!.length / 4); });
}

/** The scene clears to the palette's cream background; a lit surface differs from it by at least a few levels per channel. */
const BACKGROUND = [1, 3, 5].map(i => parseInt(ROLES.background.slice(i, i + 2), 16));
const offBackground = (rgb: readonly number[]) => Math.max(...rgb.map((v, i) => Math.abs(v - BACKGROUND[i]!)));
/** A blank part of the Payables board (right of the empty-audit note) and a point just above it, off the board. */
const PAYABLES_BOARD: Point = [-2.26, 1.47, -7.349], ABOVE_PAYABLES_BOARD: Point = [-2.26, 3.3, -7.349];
const colorDistance = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
/** Bright board pixels that are not the cream background: the focus camera settled and the board drew. */
async function payablesBoardDrawn(page: Page, canvas: Locator): Promise<number> {
  const color = await patchColor(page, canvas, PAYABLES_BOARD);
  return Math.min(...color) > 170 ? offBackground(color) : 0;
}

/** Mean (red minus blue) of a 6x6 screenshot patch: positive on warm peach, negative on aqua. */
async function patchWarmth(page: Page, canvas: Locator, point: Point, focus: readonly [number, number] = PAYABLES): Promise<number> {
  const [data] = await samplePatches(page, canvas, [point], focus);
  let sum = 0;
  for (let i = 0; i < data!.length; i += 4) sum += data![i]! - data![i + 2]!;
  return sum / (data!.length / 4);
}

const TREASURY = [2.5, 4.9] as const;

/** How far the mean red channel of RGBA pixels stands above the other two (the DENY sign's #ed6252 is about 140). */
function redness(data: readonly number[]): number {
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c]! += data[i + c]!;
  const n = data.length / 4;
  return (sum[0]! - Math.max(sum[1]!, sum[2]!)) / n;
}

/**
 * Red margins of the DENY sign board (centred (3.85, 1.1, 0.9), 1.6 x 0.72, facing +z), right half only:
 * clear of the 'DENIED' and rule text, whose position on screen shifts with the canvas size, and of the door ring and flash.
 */
// Red board spots with no ink on the taller two-line DENY sign: between the rule rows, between header and rules, and the bottom strip.
const SIGN_MARGINS = [[4.45, 1.04, 0.91], [4.55, 1.44, 0.91], [3.25, 1.04, 0.91], [3.85, 0.63, 0.91]] as const;

/** Redness at every sign margin point under the Treasury focus camera. */
async function signRedness(page: Page, canvas: Locator): Promise<number[]> {
  return (await samplePatches(page, canvas, SIGN_MARGINS, TREASURY)).map(redness);
}

test('office props render in the 3D scene', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Network status noise (e.g. the unauthenticated LLM switch probe) is not a render failure.
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
  await page.goto('/office?view=overview');
  const viewport = page.getByTestId('office-viewport');
  const canvas = viewport.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  await (await preset(page, 'Payables')).click();
  // The blank board turns bright once the focus camera settles.
  await expect.poll(() => payablesBoardDrawn(page, canvas), { timeout: 10_000 }).toBeGreaterThan(12);
  // Just above it the grounds outside the building show, not more board.
  expect(colorDistance(await patchColor(page, canvas, ABOVE_PAYABLES_BOARD), await patchColor(page, canvas, PAYABLES_BOARD))).toBeGreaterThan(12);
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
  await page.goto('/office?view=overview');
  const viewport = page.getByTestId('office-viewport');
  const canvas = viewport.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  await openMenu(page);
  await page.getByRole('button', { name: 'Show escalation' }).click();
  // The pick closes the menu; the control now offers the way back.
  await expect(page.locator('.mock-controls button', { hasText: 'Return to Collections' })).toBeAttached();
  await (await preset(page, 'Collections')).click();
  // Once the focus camera settles, the empty right strip of the Collections screen shows the aqua panel (blue above red),
  // while the lit peach desk top beside it stays bright and warm (red above blue).
  await expect.poll(() => patchBrightness(page, canvas, [-9.6, 0.912, -4.65], COLLECTIONS), { timeout: 10_000 }).toBeGreaterThan(120);
  await expect.poll(() => patchWarmth(page, canvas, [-9.6, 0.912, -4.65], COLLECTIONS), { timeout: 10_000 }).toBeGreaterThan(15);
  await expect.poll(() => patchWarmth(page, canvas, [-9.074, 1.135, -5.171], COLLECTIONS), { timeout: 10_000 }).toBeLessThan(-15);
  await expect(page.getByText(/3D unavailable/).filter({ visible: true })).toHaveCount(0);
  await expect(viewport.locator('.floor-plan')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('office ambience renders a still scene under reduced motion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/office?view=overview');
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const viewport = page.getByTestId('office-viewport');
  const canvas = viewport.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  // With the ambient ticker off, the static pose still has to reach the screen: the focused Payables board draws.
  await (await preset(page, 'Payables')).click();
  await expect.poll(() => payablesBoardDrawn(page, canvas), { timeout: 10_000 }).toBeGreaterThan(12);
  await expect(page.getByText(/3D unavailable/).filter({ visible: true })).toHaveCount(0);
  await expect(viewport.locator('.floor-plan')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('office judge tour visits the rooms with agent tags and stops on any key', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
  await expect(page.locator('canvas')).toBeVisible();
  // The preview fixture seats three agents; each gets one tag.
  await expect(page.locator('.seat-statuses > div')).toHaveCount(3);
  await expect(page.locator('[data-agent-tag]')).toHaveCount(3);
  const view = page.getByLabel('Office view');
  const caption = page.locator('.office-caption');
  await openMenu(page);
  await view.selectOption('tour');
  await expect(caption).toContainText('Tour');
  await expect(page.getByRole('button', { name: 'Stop tour', exact: true })).toBeVisible();
  // The presets live in the closed corner menu (opening it would stop the tour), so read the pressed state directly.
  await expect(page.locator('.room-navigation button').filter({ hasText: /^Lobby$/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift');
  await expect(view).toHaveValue('tween');
  await expect(caption).toHaveCount(0); // back in the overview, which shows no caption
  await expect(page.getByRole('button', { name: 'Stop tour', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('office judge tour advances under reduced motion and stops on a click', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/office?view=overview');
  await expect(page.locator('canvas')).toBeVisible();
  const view = page.getByLabel('Office view');
  const caption = page.locator('.office-caption');
  await openMenu(page);
  await view.selectOption('tour');
  await expect(caption).toContainText('Tour · 1 of');
  await expect(caption).toContainText('Tour · 2 of', { timeout: 8000 });
  const box = await page.getByTestId('office-viewport').boundingBox();
  await page.mouse.click(box!.x + 8, box!.y + 8);
  await expect(view).toHaveValue('tween');
  await expect(caption).toHaveCount(0); // back in the overview, which shows no caption
  expect(errors).toEqual([]);
});

test('office judge tour is not cancelled by the view select navigation keys', async ({ page }) => {
  // Portable: dispatch the keydown on the select itself, so no platform-specific native-select behaviour is involved.
  await page.goto('/office?view=overview');
  await expect(page.locator('canvas')).toBeVisible();
  const view = page.getByLabel('Office view');
  const caption = page.locator('.office-caption');
  await openMenu(page);
  await view.selectOption('tour');
  await expect(caption).toContainText('Tour · 1 of');
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown']) await view.dispatchEvent('keydown', { key });
  await expect(view).toHaveValue('tour');
  await expect(caption).toContainText('Tour');
  // Any other key on the select still ends the tour.
  await view.focus();
  await page.keyboard.press('Tab');
  await expect(view).toHaveValue('tween');
  await expect(caption).toHaveCount(0); // back in the overview, which shows no caption
});

test('office judge tour started with the native select arrow keys', async ({ page, browserName }) => {
  // A closed <select> changes value on ArrowDown/ArrowUp in Linux/Windows Chromium; macOS opens the popup instead.
  test.skip(process.platform === 'darwin' || browserName !== 'chromium', 'native select arrow-key navigation is platform-specific');
  await page.goto('/office?view=overview');
  await expect(page.locator('canvas')).toBeVisible();
  const view = page.getByLabel('Office view');
  const caption = page.locator('.office-caption');
  await openMenu(page);
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
  await page.goto('/office?view=overview');
  const viewport = page.getByTestId('office-viewport');
  const canvas = viewport.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  const treasury = await preset(page, /^Treasury/);
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
  await openMenu(page);
  await page.getByRole('button', { name: 'Show Treasury denial' }).click();
  // The preview button sits below the scene, so clicking it can scroll the canvas out of view.
  await canvas.scrollIntoViewIfNeeded();
  // Poll rather than sample at a fixed time: under load the first frame of the moment can land late.
  const maxRedness = async () => Math.max(...await signRedness(page, canvas));
  await expect.poll(maxRedness, { message: 'max sign redness during the moment', timeout: DENY_MOMENT_MS - 500, intervals: [100] }).toBeGreaterThan(80);
  await expect.poll(maxRedness, { message: 'max sign redness after the moment', timeout: DENY_MOMENT_MS + 4000 }).toBeLessThan(40);
  // The 3D ViewBoundary swallows render errors into its floor-plan fallback, so assert it never appeared.
  await expect(page.getByText(/3D unavailable/).filter({ visible: true })).toHaveCount(0);
  await expect(viewport.locator('.floor-plan')).toHaveCount(0);
  await openMenu(page);
  await page.getByLabel('Office view').selectOption('plan');
  await expect(page.locator('.floor-plan .denial-text')).toHaveText('Entry denied');
  expect(errors).toEqual([]);
});
