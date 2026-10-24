import { test, expect, type Page } from '@playwright/test';
import type { Gx10Status } from '../lib/gx10/status';

// Run via test:office:browser after building the web app. Needs WebGL; fails loudly without it.
const HINT = 'Click to look · WASD move · ←/→ turn · E interact · M map · Esc exit';

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
type Release =
  | { kind: 'turned'; yaw: number }
  | { kind: 'facing'; x: number; z: number; sign: number }
  | { kind: 'arrived'; x: number; z: number; tolerance: number };
/** Release in the page as soon as the rig reports the condition, before another slow frame can turn. */
async function holdInPage(page: Page, key: string, release: Release, timeout = 15_000) {
  await surface(page).evaluate((element, { key, release }) => {
    const hud = element as HTMLElement;
    hud.dataset.testHeld = key;
    const observer = new MutationObserver(() => {
      const x = Number(hud.dataset.playerX), z = Number(hud.dataset.playerZ), yaw = Number(hud.dataset.playerYaw);
      const raw = release.kind === 'turned' ? 0 : Math.atan2(-(release.x - x), -(release.z - z)) - yaw;
      const diff = Math.atan2(Math.sin(raw), Math.cos(raw));
      const done = release.kind === 'turned' ? yaw !== release.yaw
        : release.kind === 'facing' ? Math.abs(diff) <= 0.3 || Math.sign(diff) !== release.sign
        : Math.hypot(release.x - x, release.z - z) <= release.tolerance || Math.abs(diff) > 0.2;
      if (!done) return;
      hud.dataset.testHeld = 'released';
      // React's surface handler releases the input immediately; keyboard.up below also clears
      // Playwright's physical key state. A Node round trip here can otherwise add several frames.
      hud.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    });
    const cleanup = () => { observer.disconnect(); hud.removeEventListener('keyup', cleanup); };
    hud.addEventListener('keyup', cleanup);
    observer.observe(hud, { attributes: true, attributeFilter: ['data-player-x', 'data-player-z', 'data-player-yaw'] });
  }, { key, release });
  try {
    await page.keyboard.down(key);
    await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-player-yaw]')?.dataset.testHeld === 'released', undefined, { polling: 'raf', timeout });
  } finally {
    await page.keyboard.up(key);
    // Let the requested idle frame consume keyup before the next fine adjustment. Its first
    // turning frame then uses the rig's 1/60 s idle step rather than a stale slow-frame delta.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
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
    // Coarse: hold until roughly facing. Fine: hold for one turning frame (the rig turns a fixed
    // 1/60 s step on the first frame after idle).
    if (Math.abs(diff) > 0.35) await holdInPage(page, key, { kind: 'facing', x, z, sign: Math.sign(diff) });
    else await holdInPage(page, key, { kind: 'turned', yaw: (await player(page)).yaw });
  }
  const { diff } = await bearingTo(page, x, z);
  expect(Math.abs(diff)).toBeLessThanOrEqual(tolerance);
}
async function walkTo(page: Page, x: number, z: number, tolerance = 0.15) {
  for (let leg = 0; leg < 12; leg++) {
    if ((await bearingTo(page, x, z)).distance <= tolerance) return;
    await face(page, x, z);
    await holdInPage(page, 'w', { kind: 'arrived', x, z, tolerance });
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

test('play mode walks into the lobby shelf and is blocked', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await startPlay(page);
  await walkTo(page, -6.5, 0.6);
  await walkTo(page, -6.5, 1.8);
  await face(page, -7.74, 1.8);
  const start = await player(page);
  await holdUntil(page, 'w', async () => (await player(page)).x < -7.27);
  // Keep pushing past the shelf's face: without its collider the player reaches the floor edge.
  await page.keyboard.down('w');
  try { await page.waitForTimeout(1_000); }
  finally { await page.keyboard.up('w'); }
  const stopped = await player(page);
  expect(stopped.x).toBeLessThan(start.x - 0.5);
  expect(stopped.x).toBeCloseTo(-7.29, 1); // Shelf maxX -7.57 + player radius 0.28.
  expect(stopped.x).toBeGreaterThan(-7.3);
  expect(stopped.z).toBeGreaterThan(1.2);
  expect(stopped.z).toBeLessThan(2.4);
  expect(errors).toEqual([]);
});

test('play mode presses E at the whiteboard and reads its snapshot panel', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await startPlay(page);
  await walkTo(page, -4.6, 0.45);
  await walkTo(page, 1.6, 0.45);
  // Pass the right end of the Payables desk and chair to reach the back-wall board.
  await walkTo(page, 1.6, -4.2);
  await face(page, 1.1, -4.95);
  await expect(page.getByText('E · Read the whiteboard')).toBeVisible();
  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'Payables board' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Read-only');
  await expect(dialog.locator('dt')).toContainText(['Allow', 'Deny', 'Hold', 'Recorded', 'Total', 'Inbox', 'Agents', 'Connection']);
  await expect(dialog.getByRole('button', { name: 'Close Payables board' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(surface(page)).toBeFocused();
  expect(errors).toEqual([]);
});

test.describe('play mode on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('caption shows the touch hint and the joystick is visible', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/office');
    await requireWebGL(page);
    const select = page.getByLabel('Office view');
    await expect(select).toBeEnabled();
    // Narrow screens may prefer another initial view; retry until hydrated so the pick sticks.
    await expect(async () => {
      await select.selectOption({ label: 'Play (first person)' });
      await expect(surface(page)).toBeVisible({ timeout: 1_000 });
    }).toPass();
    await expect(select).toHaveValue('play');
    const caption = page.getByTestId('office-viewport').locator('.office-caption');
    await expect(caption).toHaveText('Drag to look · stick to move · tap Interact · Exit Play to leave');
    await expect(caption).not.toContainText('WASD');
    await expect(page.locator('.play-joystick')).toBeVisible();
    await expect(page.locator('.play-touch-hint')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
