import { test, expect, type Page } from '@playwright/test';
import { openMenu } from './office-menu';

// Run via test:office:browser after building the web app. Needs WebGL; fails loudly without it.
const BASE_FOV = 75;

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
  const view = surface(page);
  const [x, z, fov] = await Promise.all(['data-player-x', 'data-player-z', 'data-player-fov'].map(name => view.getAttribute(name)));
  if (x === null || z === null || fov === null) throw new Error('Play rig has not reported a position');
  return { x: Number(x), z: Number(z), fov: Number(fov) };
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
  await page.goto('/office?view=overview');
  await requireWebGL(page);
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await openMenu(page);
  await page.getByRole('button', { name: 'Play (First Person)', exact: true }).click();
  const splash = page.getByTestId('play-splash');
  if (await splash.isVisible()) await splash.getByRole('button', { name: 'Enter', exact: true }).click();
  await expect(surface(page)).toBeFocused();
  // Readiness, not a timing claim: the rig reports only after the first Play frames (shader compile) and the 0.9 s
  // fly-in, which a loaded machine can push past the default 5 s.
  await expect(surface(page)).toHaveAttribute('data-player-fov', /\d/, { timeout: 30_000 });
  return errors;
}
const stepCount = (page: Page) => page.evaluate(() => (Reflect.get(window, '__stepCues') as number[]).length);
const oscillatorCount = (page: Page) => page.evaluate(() => Number(Reflect.get(window, '__oscillators')));
async function walkFor(page: Page, ms: number) {
  await page.keyboard.down('w');
  await page.waitForTimeout(ms);
  await page.keyboard.up('w');
}
/** Release the key on the first frame the predicate is true, before the walk reaches the desk behind Alex. */
async function holdUntil(page: Page, key: string, done: () => Promise<boolean>, timeout = 15_000) {
  const started = Date.now();
  await page.keyboard.down(key);
  try {
    while (!(await done())) {
      if (Date.now() - started > timeout) throw new Error(`Holding ${key} timed out`);
      await page.waitForTimeout(16);
    }
  } finally {
    await page.keyboard.up(key);
  }
}

test('crosshair changes state and shows a short prompt over an interactable, then goes idle in the dialog', async ({ page }) => {
  const errors = await startPlay(page);
  const crosshair = page.getByTestId('office-viewport').locator('.play-crosshair');
  await expect(crosshair).toBeVisible();
  await expect(crosshair).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('.play-prompt')).toHaveText('');

  // Alex is dead ahead of the spawn point. Stop on the first target; walking on reaches the desk behind him.
  await holdUntil(page, 'w', async () => (await crosshair.getAttribute('data-state')) === 'target');
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
  await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('[data-player-fov]')?.dataset.playerFov) > 76, undefined, { polling: 'raf', timeout: 15_000 });
  const walking = await reading(page);
  expect(walking.z).toBeLessThan(start.z);
  expect(walking.fov).toBeGreaterThan(BASE_FOV);
  expect(walking.fov).toBeLessThanOrEqual(BASE_FOV + 5);
  await page.keyboard.up('w');

  // Friction stops the player within a body length, and the FOV settles back to the base.
  await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('[data-player-fov]')?.dataset.playerFov) === 75, undefined, { polling: 'raf', timeout: 15_000 });
  const stopped = await reading(page);
  await page.waitForTimeout(200);
  const later = await reading(page);
  expect(later.z).toBe(stopped.z);
  expect(Math.abs(stopped.z - walking.z)).toBeLessThan(0.5);
  expect(errors).toEqual([]);
});

test('the Play settings turn FOV kick off and remember it', async ({ page }) => {
  const errors = await startPlay(page);
  await page.getByRole('button', { name: 'Settings' }).focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Play settings' });
  await dialog.locator('summary').filter({ hasText: 'Movement Feel' }).click();
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

test.describe('system reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('explains disabled effects live, persists the office override, and resets it', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await startPlay(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Play settings' });
    const indicator = dialog.getByText('Reduced motion is on in your system, so these are off', { exact: true });
    await expect(indicator).toBeVisible();
    for (const name of ['Smooth movement', 'Head bob', 'Field-of-view kick']) {
      await expect(dialog.getByRole('checkbox', { name, exact: true })).toBeDisabled();
    }
    await expect(dialog.getByRole('slider', { name: 'Look sensitivity' })).toBeEnabled();
    await expect(dialog.getByRole('slider', { name: 'Movement speed' })).toBeEnabled();

    // The indicator responds without remounting the dialog.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(indicator).toBeHidden();
    await expect(dialog.getByRole('checkbox', { name: 'Head bob', exact: true })).toBeEnabled();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(indicator).toBeVisible();
    await dialog.getByRole('switch', { name: 'Use motion anyway' }).check();
    await expect(indicator).toBeHidden();
    for (const name of ['Smooth movement', 'Head bob', 'Field-of-view kick']) {
      await expect(dialog.getByRole('checkbox', { name, exact: true })).toBeEnabled();
    }
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('backroom.office.play-settings.v1') ?? '{}')))
      .toMatchObject({ useMotionAnyway: true });
    await dialog.getByRole('button', { name: 'Try walking' }).click();
    await page.keyboard.down('w');
    try {
      await expect.poll(async () => Number(await surface(page).getAttribute('data-player-fov')), { timeout: 15_000 }).toBeGreaterThan(BASE_FOV + 1);
    } finally { await page.keyboard.up('w'); }

    await page.reload();
    await page.getByRole('button', { name: 'Play (First Person)', exact: true }).click();
    const splash = page.getByTestId('play-splash');
    if (await splash.isVisible()) await splash.getByRole('button', { name: 'Enter', exact: true }).click();
    await expect(surface(page)).toHaveAttribute('data-player-fov', /\d/, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(dialog.getByRole('switch', { name: 'Use motion anyway' })).toBeChecked();
    await dialog.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(indicator).toBeVisible();
    await expect(dialog.getByRole('switch', { name: 'Use motion anyway' })).not.toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('backroom.office.play-settings.v1'))).toBeNull();
    await dialog.getByRole('button', { name: 'Try walking' }).click();
    const start = await reading(page);
    await walkFor(page, 700);
    const after = await reading(page);
    expect(after.z).toBeLessThan(start.z - 0.3);
    expect(after.fov).toBe(BASE_FOV);
    await expect(dialog).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('motion enabled', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('walking visibly bobs the camera and disabling bob makes it flat with Settings still open', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = await startPlay(page);
    const view = surface(page);
    await expect(view).toHaveAttribute('data-player-eye-y', /\d/, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Play settings' });
    const bob = dialog.getByRole('checkbox', { name: 'Head bob', exact: true });
    await expect(bob).toBeChecked();
    await expect(bob).toBeEnabled();

    async function sampleWalk() {
      await dialog.getByRole('button', { name: 'Try walking' }).click();
      await expect(view).toBeFocused();
      const heights: number[] = [], positions: number[] = [];
      // Back and forth stays near spawn and avoids resting against a desk during slow WebGL frames.
      for (const key of ['w', 's', 'w', 's']) {
        await page.keyboard.down(key);
        try {
          for (let i = 0; i < 8; i++) {
            heights.push(Number(await view.getAttribute('data-player-eye-y')));
            positions.push(Number(await view.getAttribute('data-player-z')));
            await page.waitForTimeout(50);
          }
        } finally { await page.keyboard.up(key); }
      }
      expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(0.3);
      return Math.max(...heights) - Math.min(...heights);
    }
    // The original 0.03 m bob reaches 0.06 m peak-to-peak after ramping up.
    expect(await sampleWalk()).toBeGreaterThanOrEqual(0.03);
    await bob.uncheck();
    await expect(page.locator('.play-settings-toast')).toHaveText('Head bob off');
    await expect(page.locator('.play-settings-toast')).toBeHidden({ timeout: 3_000 });
    expect(await sampleWalk()).toBeLessThan(0.01);
    await bob.check();
    await expect(page.locator('.play-settings-toast')).toHaveText('Head bob on');
    await expect(dialog).toBeVisible();
    expect(errors).toEqual([]);
  });
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
  await openMenu(page);
  await page.getByRole('button', { name: 'Sound off', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sound on', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await openMenu(page);
  await page.getByRole('button', { name: 'Play (First Person)', exact: true }).click();
  const splash = page.getByTestId('play-splash');
  if (await splash.isVisible()) await splash.getByRole('button', { name: 'Enter', exact: true }).click();
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-fov', /\d/, { timeout: 30_000 }); // the intro fly-in has finished
  const before = await oscillatorCount(page);
  const stepsBefore = await stepCount(page);
  await walkFor(page, 1_500);
  const newSteps = (await stepCount(page)) - stepsBefore;
  expect(newSteps).toBeGreaterThanOrEqual(2);
  expect((await oscillatorCount(page)) - before).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});

test('clicking into first person locks the pointer and hides Play controls; releasing it restores them and walking still works', async ({ page }) => {
  const errors = await startPlay(page);
  const viewport = page.getByTestId('office-viewport');
  const exit = page.getByRole('button', { name: 'Exit Play' });
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  const sound = page.getByRole('button', { name: /^Sound (on|off)$/ });
  await expect(exit).toBeVisible();
  await expect(settings).toBeVisible();
  await expect(sound).toBeVisible();
  await surface(page).click({ position: { x: 400, y: 300 } });
  await expect(surface(page)).toBeFocused();
  // Some headless builds grant the lock, others refuse it; both must leave a usable view.
  if (await page.evaluate(() => document.pointerLockElement !== null)) {
    await expect(viewport).toHaveAttribute('data-pointer-locked', '');
    await expect(exit).toBeHidden();
    await expect(settings).toBeHidden();
    // The corner menu deliberately keeps its sound toggle visible in the diegetic HUD.
    await expect(sound).toBeVisible();
    await expect(viewport.locator('.play-crosshair')).toBeVisible();
    // What Esc does in a real browser: the lock goes and the menu returns, still in Play.
    await page.evaluate(() => document.exitPointerLock());
  }
  await expect(viewport).not.toHaveAttribute('data-pointer-locked');
  await expect(exit).toBeVisible();
  await expect(settings).toBeVisible();
  await expect(surface(page)).toBeFocused();
  const start = await reading(page);
  await walkFor(page, 700);
  const after = await reading(page);
  expect(after.z).toBeLessThan(start.z - 0.3);
  expect(errors).toEqual([]);
});
