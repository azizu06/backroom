import { test, expect, type Page } from '@playwright/test';

// Run via test:office:browser after building the web app. Needs WebGL; fails loudly without it.
const BASE_FOV = 70;

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
async function reading(page: Page) {
  return surface(page).evaluate(element => {
    const { playerX, playerZ, playerFov } = (element as HTMLElement).dataset;
    if (playerX === undefined || playerZ === undefined || playerFov === undefined) throw new Error('Play rig has not reported a position (3D scene not rendering?)');
    return { x: Number(playerX), z: Number(playerZ), fov: Number(playerFov) };
  });
}
async function startPlay(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const steps: number[] = [];
    Object.defineProperty(window, '__stepCues', { get: () => steps });
    window.addEventListener('office-sound-cue', event => { if ((event as CustomEvent).detail === 'step') steps.push(performance.now()); });
    let oscillators = 0;
    Object.defineProperty(window, '__oscillators', { get: () => oscillators });
    if (window.AudioContext) {
      const create = window.AudioContext.prototype.createOscillator;
      window.AudioContext.prototype.createOscillator = function (this: AudioContext) { oscillators++; return create.call(this); };
    }
  });
  await page.goto('/office');
  await requireWebGL(page);
  const select = page.getByLabel('Office view');
  await expect(select).toBeEnabled();
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await select.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-fov', /\d/);
  return errors;
}
const stepCount = (page: Page) => page.evaluate(() => (Reflect.get(window, '__stepCues') as number[]).length);
const oscillatorCount = (page: Page) => page.evaluate(() => Number(Reflect.get(window, '__oscillators')));
async function walkFor(page: Page, ms: number) {
  await page.keyboard.down('w');
  await page.waitForTimeout(ms);
  await page.keyboard.up('w');
}

test('crosshair changes state and shows a short prompt over an interactable, then goes idle in the dialog', async ({ page }) => {
  const errors = await startPlay(page);
  const crosshair = page.getByTestId('office-viewport').locator('.play-crosshair');
  await expect(crosshair).toBeVisible();
  await expect(crosshair).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('.play-prompt')).toHaveText('');

  // Alex is dead ahead of the spawn point.
  await page.keyboard.down('w');
  try { await expect(crosshair).toHaveAttribute('data-state', 'target', { timeout: 15_000 }); } finally { await page.keyboard.up('w'); }
  await expect(crosshair).toHaveAttribute('data-kind', 'agent');
  await expect(page.locator('.play-prompt')).toHaveText('E · Talk to Alex');

  await page.keyboard.press('e');
  await expect(page.getByRole('dialog', { name: /Alex/ })).toBeVisible();
  await expect(crosshair).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('.play-prompt')).toHaveText('');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /Alex/ })).toBeHidden();
  await expect(crosshair).toHaveAttribute('data-state', 'target');

  // Backing away leaves the range: idle again.
  await page.keyboard.down('s');
  try { await expect(crosshair).toHaveAttribute('data-state', 'idle', { timeout: 15_000 }); } finally { await page.keyboard.up('s'); }
  expect(errors).toEqual([]);
});

test('walking eases the FOV out and back, and the player keeps moving', async ({ page }) => {
  const errors = await startPlay(page);
  const start = await reading(page);
  expect(start.fov).toBe(BASE_FOV);

  await page.keyboard.down('w');
  await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('[data-player-fov]')?.dataset.playerFov) > 71, undefined, { polling: 'raf', timeout: 15_000 });
  const walking = await reading(page);
  expect(walking.z).toBeLessThan(start.z);
  expect(walking.fov).toBeGreaterThan(BASE_FOV);
  expect(walking.fov).toBeLessThanOrEqual(BASE_FOV + 5);
  await page.keyboard.up('w');

  // Friction stops the player within a body length, and the FOV settles back to the base.
  await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('[data-player-fov]')?.dataset.playerFov) === 70, undefined, { polling: 'raf', timeout: 15_000 });
  const stopped = await reading(page);
  await page.waitForTimeout(200);
  const later = await reading(page);
  expect(later.z).toBe(stopped.z);
  expect(Math.abs(stopped.z - walking.z)).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

test('the Play settings turn FOV kick off and remember it', async ({ page }) => {
  const errors = await startPlay(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Play settings' });
  await expect(dialog.getByRole('checkbox', { name: 'Smooth movement' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Head bob' })).toBeChecked();
  await dialog.getByRole('checkbox', { name: 'Field-of-view kick' }).uncheck();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('backroom.office.play-settings.v1') ?? '{}'))).toMatchObject({ fovKick: false });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(surface(page)).toBeFocused();

  const start = await reading(page);
  await walkFor(page, 700);
  const after = await reading(page);
  expect(after.z).toBeLessThan(start.z - 0.3);
  expect(after.fov).toBe(BASE_FOV);
  expect(errors).toEqual([]);
});

test('reduced motion keeps the FOV fixed while walking still works', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 }, baseURL: 'http://localhost:3035' });
  const page = await context.newPage();
  try {
    const errors = await startPlay(page);
    const start = await reading(page);
    const seen = new Set<number>();
    await page.keyboard.down('w');
    for (let i = 0; i < 25; i++) { seen.add((await reading(page)).fov); await page.waitForTimeout(40); }
    await page.keyboard.up('w');
    const after = await reading(page);
    expect(after.z).toBeLessThan(start.z - 0.3);
    expect([...seen]).toEqual([BASE_FOV]);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('walking sends footstep cues, and they are silent unless the sound toggle is on', async ({ page }) => {
  const errors = await startPlay(page);
  expect(await oscillatorCount(page)).toBe(0);
  await walkFor(page, 1_500);
  const heard = await stepCount(page);
  expect(heard).toBeGreaterThanOrEqual(2);
  // Sound is off: cues are dispatched but nothing is synthesised and no AudioContext exists.
  expect(await oscillatorCount(page)).toBe(0);
  await page.keyboard.down('s');
  await page.waitForTimeout(1_000);
  await page.keyboard.up('s');
  expect(await stepCount(page)).toBeGreaterThan(heard);

  // Sound on: the same walking now makes oscillators, two per footstep.
  await page.keyboard.press('Escape');
  await expect(surface(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Sound off', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sound on', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-fov', /\d/); // the intro fly-in has finished
  const before = await oscillatorCount(page);
  const stepsBefore = await stepCount(page);
  await walkFor(page, 1_500);
  const newSteps = (await stepCount(page)) - stepsBefore;
  expect(newSteps).toBeGreaterThanOrEqual(2);
  expect((await oscillatorCount(page)) - before).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});
