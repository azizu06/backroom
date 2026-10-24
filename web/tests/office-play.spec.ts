import { test, expect, type Page } from '@playwright/test';
import type { Gx10Status } from '../lib/gx10/status';

// Run via test:office:browser after building the web app. Needs WebGL; fails loudly without it.
const HINT = 'Click to look · WASD move · ←/→ turn · E interact · Esc exit';

function surface(page: Page) {
  return page.getByRole('application', { name: /First-person office/ });
}
async function requireWebGL(page: Page) {
  const available = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  if (!available) throw new Error('WebGL is unavailable in this headless Chromium, so the first-person Play view cannot render.');
}
async function player(page: Page) {
  return surface(page).evaluate(element => {
    const { playerX, playerZ, playerYaw } = (element as HTMLElement).dataset;
    if (playerX === undefined || playerZ === undefined || playerYaw === undefined) throw new Error('Play rig has not reported a position (3D scene not rendering?)');
    return { x: Number(playerX), z: Number(playerZ), yaw: Number(playerYaw) };
  });
}
async function holdUntil(page: Page, key: string, done: () => Promise<boolean>, timeout = 15_000) {
  const started = Date.now();
  await page.keyboard.down(key);
  try {
    while (!(await done())) {
      if (Date.now() - started > timeout) throw new Error(`Holding ${key} timed out`);
      await page.waitForTimeout(10);
    }
  } finally {
    await page.keyboard.up(key);
  }
}
/**
 * Holds a key for exactly one rendered frame: keyup is dispatched from the next animation frame,
 * after the on-demand rig has run once with the first-frame dt. Deterministic small steps, so slow
 * headless frames cannot overshoot fine adjustments.
 */
async function tap(page: Page, key: string) {
  await surface(page).evaluate(async (element, key) => {
    const init = { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, bubbles: true, cancelable: true };
    element.dispatchEvent(new KeyboardEvent('keydown', init));
    await new Promise(resolve => requestAnimationFrame(resolve));
    element.dispatchEvent(new KeyboardEvent('keyup', init));
  }, key);
}
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
/** Yaw 0 looks toward -z; forward = (-sin yaw, -cos yaw). */
async function bearingTo(page: Page, x: number, z: number) {
  const p = await player(page);
  return { diff: wrap(Math.atan2(-(x - p.x), -(z - p.z)) - p.yaw), distance: Math.hypot(x - p.x, z - p.z) };
}
async function face(page: Page, x: number, z: number, tolerance = 0.08) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const { diff } = await bearingTo(page, x, z);
    if (Math.abs(diff) <= tolerance) return;
    // ArrowLeft turns left (yaw increases), ArrowRight turns right.
    const key = diff > 0 ? 'ArrowLeft' : 'ArrowRight';
    if (Math.abs(diff) > 0.35) {
      // Coarse: hold, releasing early because slow headless frames can overshoot.
      await holdUntil(page, key, async () => {
        const now = (await bearingTo(page, x, z)).diff;
        return Math.abs(now) <= 0.3 || Math.sign(now) !== Math.sign(diff);
      });
    } else {
      // Fine: one turning frame (about 0.04 rad).
      await tap(page, key);
    }
  }
  const { diff } = await bearingTo(page, x, z);
  expect(Math.abs(diff)).toBeLessThanOrEqual(tolerance * 2);
}
async function walkTo(page: Page, x: number, z: number, tolerance = 0.15) {
  for (let leg = 0; leg < 12; leg++) {
    if ((await bearingTo(page, x, z)).distance <= tolerance) return;
    await face(page, x, z);
    // Hold for the long stretch, then finish with single frames (0.05 m each) so slow frames cannot overshoot.
    await holdUntil(page, 'w', async () => {
      const { diff, distance } = await bearingTo(page, x, z);
      return distance <= tolerance + 0.4 || Math.abs(diff) > 0.2;
    });
    for (let step = 0; step < 40; step++) {
      const { diff, distance } = await bearingTo(page, x, z);
      if (distance <= tolerance || Math.abs(diff) > 0.2) break;
      await tap(page, 'w');
    }
  }
  expect((await bearingTo(page, x, z)).distance).toBeLessThanOrEqual(tolerance * 2);
}
async function startPlay(page: Page, setup?: () => Promise<void>) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office');
  await requireWebGL(page);
  await setup?.();
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await select.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
  return errors;
}

test('play mode walks to Alex, opens the talk panel and exits back to the previous view', async ({ page }) => {
  const errors = await startPlay(page);
  const viewport = page.getByTestId('office-viewport');
  await expect(viewport.locator('.office-caption')).toHaveText(HINT);
  await expect(viewport.locator('.play-crosshair')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exit Play' })).toBeVisible();
  const start = await player(page);

  const prompt = page.getByText('E · Talk to Alex');
  await holdUntil(page, 'w', () => prompt.isVisible());
  await expect(prompt).toBeVisible();
  // Name tags from the judge tour stay on in Play: Alex is right ahead.
  await expect(viewport.locator('[data-agent-tag]', { hasText: 'Alex' })).toBeVisible();
  const moved = await player(page);
  expect(moved.z).toBeLessThan(start.z - 0.1);
  expect(Math.abs(moved.x - start.x)).toBeLessThan(0.05);

  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: /Alex/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Reviewing invoice 1042');
  await expect(dialog.getByRole('button', { name: /^Close/ })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(surface(page)).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Office view')).toHaveValue('walk');
  await expect(viewport.locator('.play-crosshair')).toHaveCount(0);
  await expect(surface(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('play mode walks to the locked Treasury door by keyboard and shows the denial', async ({ page }) => {
  const errors = await startPlay(page, async () => {
    // Retry until hydrated: a click before hydration is a no-op.
    await expect(async () => {
      await page.getByRole('button', { name: 'Preview Treasury denial' }).click();
      await expect(page.getByRole('button', { name: /^Treasury · .*entry denied/ })).toBeVisible({ timeout: 500 });
    }).toPass();
  });

  await walkTo(page, -4.6, 0.45);
  await walkTo(page, 5, 0.45);
  await face(page, 5, 1.15);
  const prompt = page.getByText('E · Treasury door');
  await expect(prompt).toBeVisible();
  const at = await player(page);
  expect(at.z).toBeLessThan(1.05);

  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: /Treasury/ });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Locked · Dana only');
  await expect(dialog).toContainText('NOT_IN_BADGE');
  await expect(dialog).toContainText('DENY');
  await expect(dialog.locator('code')).toHaveText(/^preview-denial-\d+$/);
  expect(errors).toEqual([]);
});

test('play mode walks to the GX10 server room and reads live telemetry read-only', async ({ page }) => {
  // Longest walk in the suite; headless software WebGL renders slowly.
  test.setTimeout(60_000);
  const methods: string[] = [];
  await page.route('**/api/gx10', async route => {
    methods.push(route.request().method());
    const now = new Date().toISOString();
    const status: Gx10Status = {
      measuredAt: now, reachable: true, models: ['qwen2.5:7b'], gpuUtilization: null,
      telemetry: {
        scope: 'process-local, last 200 HTTP attempts', totalCalls: 4, localCalls: 3, localShare: 0.75,
        pricedLocalCalls: 3, estimatedSavingsUsd: 0.0012, comparisonModel: 'claude-haiku-4-5',
        recent: { at: now, latencyMs: 900, tokensPerSecond: 42.5 },
      },
    };
    await route.fulfill({ json: status });
  });
  const errors = await startPlay(page);

  // Around the partitions and door posts: lobby aisle, along z 0.45, then in front of the server.
  await walkTo(page, -4.6, 0.45);
  await walkTo(page, 5, 0.45);
  await walkTo(page, 7.1, 0.4);
  await face(page, 7.1, -0.8);
  const prompt = page.getByText('E · Check GX10 server');
  await expect(prompt).toBeVisible();
  const at = await player(page);
  // The server box (z -1.325..-0.275) is solid: the player stays in front of its face.
  expect(at.z).toBeGreaterThan(-0.275);

  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'GX10 server' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Close/ })).toBeFocused();
  await expect(dialog.getByTestId('play-gx10-speed')).toHaveText('42.5 tok/s');
  await expect(dialog).toContainText('Online');
  await expect(dialog).toContainText('qwen2.5:7b');
  await expect(dialog).toContainText('0.90 s');
  await expect(dialog).toContainText('75%');
  await expect(dialog).toContainText('3/4 attempts local');
  await expect(dialog).toContainText('Read-only');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(surface(page)).toBeFocused();
  expect(methods.length).toBeGreaterThan(0);
  expect(methods.every(method => method === 'GET')).toBe(true);
  expect(errors).toEqual([]);
});
