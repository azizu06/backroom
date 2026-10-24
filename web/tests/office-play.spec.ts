import { test, expect, type Page } from '@playwright/test';

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
      // Fine: hold only until the rig has rendered one turning frame.
      const { yaw } = await player(page);
      await holdUntil(page, key, async () => (await player(page)).yaw !== yaw);
    }
  }
  const { diff } = await bearingTo(page, x, z);
  expect(Math.abs(diff)).toBeLessThanOrEqual(tolerance * 2);
}
async function walkTo(page: Page, x: number, z: number, tolerance = 0.15) {
  for (let leg = 0; leg < 12; leg++) {
    if ((await bearingTo(page, x, z)).distance <= tolerance) return;
    await face(page, x, z);
    await holdUntil(page, 'w', async () => {
      const { diff, distance } = await bearingTo(page, x, z);
      return distance <= tolerance || Math.abs(diff) > 0.2;
    });
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
