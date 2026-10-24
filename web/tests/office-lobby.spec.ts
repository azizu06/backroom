import { test, expect, type Locator, type Page } from '@playwright/test';
import { EYE_HEIGHT, guidePose } from '../lib/office/play';
import type { AnchorId } from '../lib/office/state';
import { DENY_MOMENT_MS } from '../lib/office/props/treasuryDeny';

// Run via test:office:browser after building the web app.
const code = process.env.OFFICE_LOBBY_OPERATOR_CODE ?? 'local-audit-test-only';
if (process.env.OFFICE_LOBBY_URL) test.use({ baseURL: process.env.OFFICE_LOBBY_URL });

test('office lobby mounts the live audit wall and ask-why without breaking the office layout', async ({ page }) => {
  const errors: string[] = [], audit: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/audit/')) audit.push(path); });
  await page.goto('/office?view=overview');
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
  await page.goto('/office?view=overview');
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
  await page.goto('/office?view=overview');
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

/** Vertical field of view of the Play camera (web/app/office/play.tsx). */
const PLAY_FOV = 70;

/**
 * Screen position of a world point from the first-person camera at the end of a guided walk to `room`
 * (guidePose: eye at EYE_HEIGHT, Euler(pitch, yaw, 0, 'YXZ'), perspective with PLAY_FOV).
 */
function projectPlay([px, py, pz]: readonly [number, number, number], width: number, height: number, room: AnchorId): [number, number] {
  const { position: [ex, ez], yaw, pitch } = guidePose(room);
  const forward = [-Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), -Math.cos(pitch) * Math.cos(yaw)] as const;
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)] as const;
  const up = [Math.sin(pitch) * Math.sin(yaw), Math.cos(pitch), Math.sin(pitch) * Math.cos(yaw)] as const;
  const d = [px - ex, py - EYE_HEIGHT, pz - ez] as const;
  const dot = (v: readonly number[]) => v[0]! * d[0] + v[1]! * d[1] + v[2]! * d[2];
  const depth = dot(forward), half = Math.tan((PLAY_FOV * Math.PI) / 360);
  return [width / 2 * (1 + dot(right) / (depth * half * (width / height))), height / 2 * (1 - dot(up) / (depth * half))];
}

/** Waits until a guided walk to `room` has arrived (the HUD reports the guide pose). */
async function arrived(page: Page, room: AnchorId) {
  const { position: [x, z], yaw } = guidePose(room);
  await page.waitForFunction(({ x, z, yaw }) => {
    const hud = document.querySelector<HTMLElement>('[data-player-yaw]');
    if (!hud) return false;
    return Math.abs(Number(hud.dataset.playerX) - x) < 0.01 && Math.abs(Number(hud.dataset.playerZ) - z) < 0.01
      && Math.abs(Math.atan2(Math.sin(Number(hud.dataset.playerYaw) - yaw), Math.cos(Number(hud.dataset.playerYaw) - yaw))) < 0.01;
  }, { x, z, yaw }, { polling: 'raf', timeout: 10_000 });
}

/** Forces the WebGL context loss path: the office falls back to the 2D floor plan. */
async function loseContext(page: Page) {
  await page.getByTestId('office-viewport').locator('canvas').evaluate(canvas => {
    const gl = (canvas as HTMLCanvasElement).getContext('webgl2') ?? (canvas as HTMLCanvasElement).getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  });
}

type Point = readonly [number, number, number];

/**
 * RGBA pixels of a 6x6 patch around each world point projected from the guided-walk pose for `room`, all from one screenshot.
 * Page layout or a click can scroll the page, so scroll the canvas back into view first and fail
 * clearly if a patch is not inside both the canvas and the viewport. One screenshot per call keeps
 * sampling cheap while the scene animates, when every page round trip slows down.
 */
async function samplePatches(page: Page, canvas: Locator, points: readonly Point[], room: AnchorId): Promise<number[][]> {
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const view = page.viewportSize()!;
  const corners = points.map(point => {
    const [x, y] = projectPlay(point, box.width, box.height, room);
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
async function patchBrightness(page: Page, canvas: Locator, point: Point, room: AnchorId = 'payables'): Promise<number> {
  const [data] = await samplePatches(page, canvas, [point], room);
  let sum = 0;
  for (let i = 0; i < data!.length; i += 4) sum += Math.min(data![i]!, data![i + 1]!, data![i + 2]!);
  return sum / (data!.length / 4);
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
  await page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: 'Payables', exact: true }).click();
  await arrived(page, 'payables');
  // A blank part of the board (right of the empty-audit note) turns cream once the guided walk arrives; just above it is background.
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
  await page.goto('/office?view=overview');
  const viewport = page.getByTestId('office-viewport');
  const canvas = viewport.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview escalation' }).click();
  await expect(page.getByRole('button', { name: 'Return to Collections' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: 'Collections', exact: true }).click();
  await arrived(page, 'collections');
  // Once the guided walk arrives, the empty right strip of the Collections screen shows the panel's #1d2420 (min channel 29),
  // not the bright accent face (#a9bc8f) behind it, while the lit desk top beside it stays bright.
  await expect.poll(() => patchBrightness(page, canvas, [-5.6, 0.912, -2.65], 'collections'), { timeout: 10_000 }).toBeGreaterThan(120);
  await expect.poll(() => patchBrightness(page, canvas, [-5.074, 1.135, -3.171], 'collections'), { timeout: 10_000 }).toBeLessThan(60);
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
  await page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: 'Payables', exact: true }).click();
  await arrived(page, 'payables');
  await expect.poll(() => patchBrightness(page, canvas, [1.74, 1.47, -5.349]), { timeout: 10_000 }).toBeGreaterThan(170);
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
  const caption = page.locator('.office-caption');
  await page.getByRole('button', { name: 'Tour', exact: true }).click();
  await expect(caption).toContainText('Tour');
  await expect(page.getByRole('button', { name: 'Stop tour', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: 'Lobby', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Shift');
  await expect(caption).not.toContainText('Tour');
  await expect(page.getByRole('button', { name: 'Stop tour', exact: true })).toHaveCount(0);
  // The tour ends in first person: the Play surface and the Tour button are back.
  await expect(page.getByRole('application', { name: /First-person office/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tour', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('office judge tour walks the Play camera to each stop under reduced motion and stops on a click', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/office?view=overview');
  await expect(page.locator('canvas')).toBeVisible();
  const caption = page.locator('.office-caption');
  await page.getByRole('button', { name: 'Tour', exact: true }).click();
  await expect(caption).toContainText('Tour · 1 of');
  await arrived(page, 'lobby');
  await expect(caption).toContainText('Tour · 2 of', { timeout: 8000 });
  await arrived(page, 'collections');
  const box = await page.getByTestId('office-viewport').boundingBox();
  await page.mouse.click(box!.x + 8, box!.y + 8);
  await expect(caption).not.toContainText('Tour');
  expect(errors).toEqual([]);
});

/**
 * Highest redness over a grid of 8x8 patches covering the canvas, from one screenshot. Redness is how far a patch's
 * mean red channel stands above the other two (the DENY red #ed6252 is about 140). Computed in the page so each
 * sample returns one number.
 */
async function maxCanvasRedness(page: Page, canvas: Locator): Promise<number> {
  await canvas.scrollIntoViewIfNeeded();
  const png = await canvas.screenshot();
  return page.evaluate(async src => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const surface = document.createElement('canvas');
    surface.width = image.width;
    surface.height = image.height;
    const ctx = surface.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    let max = -Infinity;
    for (let y = 0; y + 8 <= image.height; y += 16) for (let x = 0; x + 8 <= image.width; x += 16) {
      const sum = [0, 0, 0];
      for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) for (let c = 0; c < 3; c++) sum[c]! += data[((y + dy) * image.width + x + dx) * 4 + c]!;
      max = Math.max(max, (sum[0]! - Math.max(sum[1]!, sum[2]!)) / 64);
    }
    return max;
  }, `data:image/png;base64,${png.toString('base64')}`);
}

test('office Treasury denial preview plays the door moment in first person without breaking the scene', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
  await page.goto('/office?view=overview');
  const viewport = page.getByTestId('office-viewport');
  const canvas = viewport.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  const treasury = page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: /^Treasury/ });
  await treasury.click();
  await expect(treasury).toHaveAttribute('aria-pressed', 'true');
  // The guided walk ends in the aisle facing the locked door: nothing on screen is DENY red yet.
  await arrived(page, 'treasury');
  const before = await maxCanvasRedness(page, canvas);
  expect(before, 'redness before the preview').toBeLessThan(60);
  await page.getByRole('button', { name: 'Preview Treasury denial' }).click();
  await expect(page.getByRole('button', { name: /^Treasury · .*entry denied/ })).toBeVisible();
  // The preview button sits below the scene, so clicking it can scroll the canvas out of view.
  await canvas.scrollIntoViewIfNeeded();
  // Poll rather than sample at a fixed time: under load the first frame of the moment can land late.
  await expect.poll(() => maxCanvasRedness(page, canvas), { message: 'max redness during the moment', timeout: DENY_MOMENT_MS - 500, intervals: [100] }).toBeGreaterThan(80);
  await expect.poll(() => maxCanvasRedness(page, canvas), { message: 'max redness after the moment', timeout: DENY_MOMENT_MS + 4000 }).toBeLessThan(60);
  // The 3D ViewBoundary swallows render errors into its floor-plan fallback, so assert it never appeared.
  await expect(page.getByText(/3D unavailable/).filter({ visible: true })).toHaveCount(0);
  await expect(viewport.locator('.floor-plan')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('office falls back to the 2D floor plan only when WebGL is lost, and Retry 3D brings first person back', async ({ page }) => {
  await page.goto('/office?view=overview');
  const viewport = page.getByTestId('office-viewport');
  await expect(viewport.locator('canvas')).toBeVisible();
  await expect(viewport.locator('.floor-plan')).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview Treasury denial' }).click();
  await loseContext(page);
  await expect(page.getByLabel('2D office floor plan')).toBeVisible();
  await expect(viewport.locator('.office-caption')).toHaveText('3D unavailable · floor plan active');
  await expect(page.locator('.floor-plan .denial-text')).toHaveText('Entry denied');
  await expect(page.getByRole('application', { name: /First-person office/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry 3D' }).click();
  await expect(viewport.locator('.floor-plan')).toHaveCount(0);
  await expect(page.getByRole('application', { name: /First-person office/ })).toBeVisible();
});
