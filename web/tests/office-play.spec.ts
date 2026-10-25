import { test, expect, type Page } from '@playwright/test';
import type { Gx10Status } from '../lib/gx10/status';

// Run via test:office:browser after building the web app. Needs WebGL; fails loudly without it.
const HINT = 'Click to look · WASD move · ←/→ turn · E interact · O overview · Esc exit';

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
/**
 * Holds `key` until the release condition holds, checked in the page on every animation frame so
 * slow headless frames do not overshoot while a Node-side poll round-trips.
 */
async function holdInPage(page: Page, key: string, release: Release, timeout = 15_000) {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(r => {
      const element = document.querySelector<HTMLElement>('[data-player-yaw]');
      if (!element) return false;
      const x = Number(element.dataset.playerX), z = Number(element.dataset.playerZ), yaw = Number(element.dataset.playerYaw);
      if (r.kind === 'turned') return yaw !== r.yaw;
      const raw = Math.atan2(-(r.x - x), -(r.z - z)) - yaw;
      const diff = Math.atan2(Math.sin(raw), Math.cos(raw));
      if (r.kind === 'facing') return Math.abs(diff) <= 0.3 || Math.sign(diff) !== r.sign;
      return Math.hypot(r.x - x, r.z - z) <= r.tolerance || Math.abs(diff) > 0.2;
    }, release, { polling: 'raf', timeout });
  } finally {
    await page.keyboard.up(key);
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
  expect(Math.abs(diff)).toBeLessThanOrEqual(tolerance * 2);
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
  await page.goto('/office?view=overview');
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
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();
  const start = await player(page);

  const prompt = page.getByText('E · Talk to Alex');
  await holdUntil(page, 'w', () => prompt.isVisible());
  await expect(prompt).toBeVisible();
  // Diegetic HUD: the floating 2D name tag gives way to Alex's in-world desk sign; the prompt above names him.
  await expect(viewport.locator('[data-agent-tag]', { hasText: 'Alex' })).toBeHidden();
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
  test.setTimeout(60_000);
  const errors = await startPlay(page, async () => {
    // Retry until hydrated: a click before hydration is a no-op.
    await expect(async () => {
      // Preview controls sit in the corner menu (closed by default); a pick closes it again.
      const menu = page.getByRole('button', { name: 'Backroom menu' });
      if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
      await page.getByRole('button', { name: 'Show Treasury denial' }).click();
      await expect(page.getByRole('button', { name: /^Treasury · .*entry denied/ })).toBeVisible({ timeout: 500 });
    }).toPass();
  });

  // Along the corridor to the Treasury door (2.5, 1.5); its locked leaf closes the doorway.
  await walkTo(page, 2.5, 0.8);
  await face(page, 2.5, 1.5);
  const prompt = page.getByText('E · Treasury door');
  await expect(prompt).toBeVisible();
  const at = await player(page);
  expect(at.z).toBeLessThan(1.2);

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
  test.setTimeout(90_000);
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

  // Down the corridor, through the server-room doorway (x 9.5), then in front of the rack.
  await walkTo(page, 8.6, 0.2);
  await walkTo(page, 10.9, 0.45);
  await face(page, 10.9, -0.8);
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

test('play mode walks with a gamepad left stick and A does nothing when facing nothing', async ({ page }) => {
  const consoleErrors: string[] = [];
  // Resource 401s from unauthenticated app endpoints are unrelated to the pad; script errors count.
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) consoleErrors.push(message.text()); });
  await page.addInitScript(() => {
    const pad = {
      id: 'Fake standard pad', index: 0, connected: true, mapping: 'standard', timestamp: 0,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    const fake = window as unknown as { __pad: typeof pad; __padConnected: boolean };
    fake.__pad = pad;
    fake.__padConnected = false;
    Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => (fake.__padConnected ? [fake.__pad] : []) });
  });
  const errors = await startPlay(page);
  const start = await player(page);
  await page.evaluate(() => {
    (window as unknown as { __padConnected: boolean }).__padConnected = true;
    window.dispatchEvent(new Event('gamepadconnected'));
  });

  await page.evaluate(() => { (window as unknown as { __pad: { axes: number[] } }).__pad.axes[1] = -1; });
  await page.waitForFunction(z => Number(document.querySelector<HTMLElement>('[data-player-z]')?.dataset.playerZ) < z - 0.1, start.z, { polling: 'raf' });
  await page.evaluate(() => { (window as unknown as { __pad: { axes: number[] } }).__pad.axes[1] = 0; });
  const moved = await player(page);
  expect(moved.z).toBeLessThan(start.z - 0.1);
  expect(Math.abs(moved.x - start.x)).toBeLessThan(0.05);
  // Stick released: the player stops.
  await page.waitForTimeout(300);
  const stopped = await player(page);
  await page.waitForTimeout(300);
  expect((await player(page)).z).toBe(stopped.z);

  const prompt = page.getByTestId('office-viewport').locator('.play-prompt');
  await expect(prompt).toHaveText('');
  const setA = (pressed: boolean) => page.evaluate(value => {
    (window as unknown as { __pad: { buttons: { pressed: boolean }[] } }).__pad.buttons[0]!.pressed = value;
  }, pressed);
  await setA(true);
  await page.waitForTimeout(300);
  await setA(false);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(surface(page)).toBeVisible();
  expect(errors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test.describe('play mode on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('caption shows the touch hint and the joystick is visible', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/office?view=overview');
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
    await expect(caption).toHaveText('Drag to look · stick to move · tap Interact · Overview to leave');
    await expect(caption).not.toContainText('WASD');
    await expect(page.locator('.play-joystick')).toBeVisible();
    await expect(page.locator('.play-touch-hint')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test('play settings change speed and invert Y, persist per viewer and return focus to the play surface', async ({ page }) => {
  const errors = await startPlay(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Play settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("slider", { name: /Look sensitivity/ })).toBeFocused();
  await expect(dialog).toContainText('Movement speed 1×');

  await dialog.getByRole("slider", { name: /Movement speed/ }).fill('2');
  await dialog.getByRole("checkbox", { name: /Invert Y/ }).check();
  await expect(dialog).toContainText('Movement speed 2×');
  const stored = await page.evaluate(() => localStorage.getItem('backroom.office.play-settings.v1'));
  expect(JSON.parse(stored ?? '{}')).toMatchObject({ sensitivity: 1, invertY: true, speed: 2 });

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(surface(page)).toBeFocused();

  // Walking still works after closing the panel (speed scaling itself is covered by the unit test).
  const start = await player(page);
  await page.keyboard.down('w');
  await page.waitForTimeout(400);
  await page.keyboard.up('w');
  const moved = await player(page);
  expect(start.z - moved.z).toBeGreaterThan(0.3);

  // Leaving and re-entering Play keeps the saved values.
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Office view')).toHaveValue('walk');
  await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(dialog).toContainText('Movement speed 2×');
  await expect(dialog.getByRole("checkbox", { name: /Invert Y/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(dialog).toContainText('Movement speed 1×');
  expect(await page.evaluate(() => localStorage.getItem('backroom.office.play-settings.v1'))).toBeNull();
  expect(errors).toEqual([]);
});
