import { test, expect, type Page } from '@playwright/test';
import { openMenu, openPanels } from './office-menu';

// Mock handoff stream (`?handoffs=mock`). Run via test:office:browser after building; needs WebGL.
// Set HANDOFF_SHOTS=/some/dir to also save demo screenshots there.
const SHOTS = process.env.HANDOFF_SHOTS;
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/handoff-${name}.png` });
}
async function requireWebGL(page: Page) {
  const available = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  if (!available) throw new Error('WebGL is unavailable in this headless Chromium, so the 3D handoffs cannot render.');
}
function log(page: Page) {
  return page.getByRole('log');
}
function tag(page: Page, actor: string) {
  return page.locator(`[data-handoff-actor='${actor}']`);
}

const HANDOFF_TEST_EPOCH = 1_800_000_000_000;
async function installHandoffClock(page: Page) {
  await page.addInitScript(epoch => {
    let now = epoch;
    Date.now = () => now;
    Object.defineProperty(window, '__setHandoffTestNow', {
      configurable: true,
      value: (next: number) => { now = next; },
    });
  }, HANDOFF_TEST_EPOCH);
}
async function setHandoffTime(page: Page, elapsed: number) {
  await page.evaluate(([epoch, offset]) => {
    (window as typeof window & { __setHandoffTestNow(next: number): void }).__setHandoffTestNow(epoch + offset);
  }, [HANDOFF_TEST_EPOCH, elapsed] as const);
}

test('mock handoffs walk folders between desks, return a rejected folder, show a correction and call Dana only for the passkey', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?handoffs=mock&view=overview&handoffSpeed=4');
  await openPanels(page);
  await requireWebGL(page);
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Agent handoffs' })).toBeVisible();
  await expect(log(page)).toContainText('Intake → Extractor · INV-1042', { timeout: 15_000 });
  // Overlap: collections → auditor is logged alongside the first intake handoff.
  await expect(log(page)).toContainText('Collections → Auditor · INV-0977');
  await expect(tag(page, 'intake')).toBeVisible();
  // Dana is not on the floor before the passkey step.
  await expect(tag(page, 'human')).toBeHidden();
  await expect(page.locator('.handoff-bubble:not([hidden])').first()).toBeVisible({ timeout: 10_000 });
  await shot(page, 'pass');

  const failure = page.locator(".handoff-bubble[data-tone='fail']:not([hidden])");
  await expect(failure).toBeVisible({ timeout: 20_000 });
  await expect(failure).toContainText('Remit-to ••4821');
  await expect(tag(page, 'extractor')).toHaveAttribute('data-returning', 'true', { timeout: 10_000 });
  // The feed keeps running, so later rejections can already be listed: look for this one rather than the only one.
  await expect(log(page).locator("li[data-status='rejected']", { hasText: 'VENDOR_MISMATCH' }).first()).toBeVisible();
  await shot(page, 'fail-return');

  await expect(page.locator(".handoff-bubble[data-tone='correction']:not([hidden])").first()).toContainText('Correction', { timeout: 20_000 });
  await expect(tag(page, 'human')).toBeVisible({ timeout: 30_000 });
  await expect(tag(page, 'human').locator(".handoff-bubble[data-tone='passkey']")).toBeVisible({ timeout: 5_000 });
  await expect(log(page)).toContainText('waiting for Dana’s passkey');
  await shot(page, 'passkey');
  expect(errors).toEqual([]);
});

test('reduced motion lists handoffs instead of animating them', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/office?handoffs=mock&view=overview&handoffSpeed=4');
  await openPanels(page);
  await requireWebGL(page);
  const region = page.getByRole('region', { name: 'Agent handoffs' });
  await expect(region).toContainText('Reduced motion · listed instead of animated');
  await expect(log(page)).toHaveAttribute('aria-live', 'polite');
  await expect(log(page)).toContainText('Intake → Extractor', { timeout: 15_000 });
  await expect(log(page).locator("li[data-status='rejected']")).toBeVisible({ timeout: 20_000 });
  // Nobody walks: no tag is ever marked as returning.
  await expect(page.locator(".handoff-tag[data-returning='true']")).toHaveCount(0);
  await region.scrollIntoViewIfNeeded();
  await shot(page, 'reduced-log');
});

test('renders the first four handoffs from the mocked feed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installHandoffClock(page);
  await page.goto('/office?handoffs=mock&view=overview&handoffSpeed=8');
  await openPanels(page);
  await requireWebGL(page);
  const entries = log(page).locator('li[data-status]');
  await expect(page.getByText('No handoffs yet.')).toBeVisible();
  // Feed lead is 600 ms; at 2,000 ms the fourth row has arrived and the fifth has not.
  await setHandoffTime(page, 2_000);
  // The first four fixture handoffs include the first five-role chain and arrive before later fixtures.
  await expect(entries).toHaveCount(4, { timeout: 15_000 });
  // Real wall-clock delay cannot race this assertion into a later fixture snapshot.
  await page.waitForTimeout(1_000);
  await expect(entries).toHaveCount(4);
  await expect(entries.nth(0)).toContainText('Intake → Extractor · INV-1042');
  await expect(entries.nth(1)).toContainText('Collections → Auditor · INV-0977');
  await expect(entries.nth(2)).toContainText('Intake → Extractor · INV-1043');
  await expect(entries.nth(3)).toContainText('Extractor → Vendor verifier · INV-1043');
});

// --- Play helpers (same conventions as office-play.spec.ts) ---
function surface(page: Page) {
  return page.getByRole('application', { name: /First-person office/ });
}
async function player(page: Page) {
  return surface(page).evaluate(element => {
    const { playerX, playerZ, playerYaw } = (element as HTMLElement).dataset;
    if (playerX === undefined || playerZ === undefined || playerYaw === undefined) throw new Error('Play rig has not reported a position');
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
async function bearing(page: Page, x: number, z: number) {
  const p = await player(page);
  return wrap(Math.atan2(-(x - p.x), -(z - p.z)) - p.yaw);
}
/** Turns toward (x, z), checking in the page every animation frame so slow headless frames cannot overshoot unseen. */
async function face(page: Page, x: number, z: number, tolerance = 0.08) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const diff = await bearing(page, x, z);
    if (Math.abs(diff) <= tolerance) return;
    const key = diff > 0 ? 'ArrowLeft' : 'ArrowRight';
    const { yaw } = await player(page);
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(({ x, z, yaw, diff }) => {
        const element = document.querySelector<HTMLElement>('[data-player-yaw]');
        if (!element) return false;
        const next = Number(element.dataset.playerYaw);
        if (Math.abs(diff) <= 0.35) return next !== yaw;
        const raw = Math.atan2(-(x - Number(element.dataset.playerX)), -(z - Number(element.dataset.playerZ))) - next;
        const remaining = Math.atan2(Math.sin(raw), Math.cos(raw));
        return Math.abs(remaining) <= 0.3 || Math.sign(remaining) !== Math.sign(diff);
      }, { x, z, yaw, diff }, { polling: 'raf' });
    } finally { await page.keyboard.up(key); }
  }
  expect(Math.abs(await bearing(page, x, z))).toBeLessThanOrEqual(tolerance * 2);
}

test('play mode: facing a handoff agent and pressing E shows the handoff details', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/office?handoffs=mock&view=overview');
  await requireWebGL(page);
  // Intake's two handoffs finish within a few seconds; then it stands at its lobby station until the next cycle.
  await expect(log(page)).toContainText('INV-1043', { timeout: 10_000 });
  await page.waitForTimeout(6_000);
  await openMenu(page);
  await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/, { timeout: 15_000 });
  // Intake stands in the lobby at (-10, 4), behind and to the left of the spawn; the path through the lobby opening is clear.
  const prompt = page.getByText('E · Ask Intake about the handoff');
  await face(page, -10, 4);
  // Interact reach is short (#129): step toward Intake until the prompt appears.
  await holdUntil(page, 'w', () => prompt.isVisible());
  await expect(prompt).toBeVisible();
  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: /Intake · handoff/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.play-panel-handoff')).toContainText('Extractor');
  await expect(dialog).toContainText('INV-1043');
  await shot(page, 'play-details');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

// --- Voices (#133): the /api/handoff proxy is mocked; the real voice server needs CARTESIA_API_KEY. ---
function silentWav(ms = 200) {
  const rate = 8000, samples = Math.round(rate * ms / 1000), data = samples * 2;
  const buffer = Buffer.alloc(44 + data);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + data, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(data, 40);
  return buffer;
}
const VOICE_ROLES = ['intake_sorter', 'extractor', 'vendor_verifier', 'payables', 'collections_caller', 'reconciler', 'auditor'];

test('voices stay off until enabled, then speak handoff lines through the proxy', async ({ page }) => {
  const lines: { role: string; text: string }[] = [];
  await page.route('**/api/handoff', async route => {
    lines.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?handoffs=mock&view=overview&handoffSpeed=4');
  await openPanels(page);
  const toggle = page.getByRole('button', { name: 'Voices off' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1500);
  expect(lines).toEqual([]);
  await toggle.click();
  await expect(page.getByRole('button', { name: 'Voices on' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => lines.length, { timeout: 20_000 }).toBeGreaterThan(0);
  for (const line of lines) {
    expect(Object.keys(line).sort()).toEqual(['role', 'text']);
    expect(VOICE_ROLES).toContain(line.role);
    expect(Array.from(line.text).length).toBeLessThanOrEqual(240);
    expect(line.text).not.toMatch(/[<>\x00-\x1f]/);
  }
  expect(errors).toEqual([]);
});

test('a failing voice proxy falls back to silent visuals', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/handoff', route => { calls++; return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"VOICE_NOT_CONFIGURED"}' }); });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?handoffs=mock&view=overview&handoffSpeed=4');
  await openPanels(page);
  await page.getByRole('button', { name: 'Voices off' }).click();
  await expect(page.getByText('Voices unavailable · visuals only')).toBeVisible({ timeout: 20_000 });
  const after = calls;
  await expect(page.locator('.handoff-bubble:not([hidden])').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2000);
  expect(calls).toBe(after);
  expect(errors).toEqual([]);
});
