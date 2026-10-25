import { test, expect, type Page } from '@playwright/test';

const surface = (page: Page) => page.getByRole('application', { name: /First-person office/ });
async function player(page: Page) {
  return surface(page).evaluate(element => {
    const { playerX, playerZ } = (element as HTMLElement).dataset;
    if (playerX === undefined || playerZ === undefined) throw new Error('Play rig has not reported a pose');
    return { x: Number(playerX), z: Number(playerZ) };
  });
}
async function walkForward(page: Page, timeout: number) {
  const start = await player(page);
  await page.keyboard.down('w');
  try {
    await expect.poll(async () => start.z - (await player(page)).z, { timeout, intervals: [20] }).toBeGreaterThan(0.03);
    expect(Math.abs((await player(page)).x - start.x)).toBeLessThan(0.05);
  } finally {
    await page.keyboard.up('w');
  }
}

test('Play hands control over after the intro and immediately with reduced motion', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/office');
  const available = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  expect(available, 'Play requires WebGL').toBe(true);
  const view = page.getByLabel('Office view');
  await expect(view).toHaveValue('walk');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await view.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await page.waitForTimeout(1200);
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
  await walkForward(page, 2000);

  await page.keyboard.press('Escape');
  await expect(view).toHaveValue('walk');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // No intro wait: the fresh spawn pose (z 0.600, not the previous session's) and movement must arrive before a 900 ms
  // glide could finish. Timed in page time (event to DOM write) so a busy renderer slowing Playwright's own polling
  // round trips cannot fail it; the rig writes data-player-z only once the intro is over.
  await page.evaluate(() => {
    const clock = { entered: NaN, spawned: NaN, keyed: NaN, moved: NaN, spawnZ: '' };
    Reflect.set(window, '__introClock', clock);
    document.querySelector('select[aria-label="Office view"]')?.addEventListener('change', () => { clock.entered ||= performance.now(); }, { capture: true, once: true });
    document.addEventListener('keydown', event => { if (event.key === 'w' && Number.isNaN(clock.keyed)) clock.keyed = performance.now(); }, true);
    new MutationObserver(() => {
      const z = document.querySelector<HTMLElement>('[data-player-z]')?.dataset.playerZ;
      if (z === undefined) return;
      if (Number.isNaN(clock.spawned)) { clock.spawned = performance.now(); clock.spawnZ = z; }
      else if (!Number.isNaN(clock.keyed) && Number.isNaN(clock.moved) && Number(clock.spawnZ) - Number(z) > 0.03) clock.moved = performance.now();
    }).observe(document.body, { attributes: true, attributeFilter: ['data-player-z'], subtree: true });
  });
  await view.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-z', '0.600');
  await page.keyboard.down('w');
  try {
    await expect.poll(() => page.evaluate(() => Number.isNaN((Reflect.get(window, '__introClock') as { moved: number }).moved)), { timeout: 5000 }).toBe(false);
  } finally {
    await page.keyboard.up('w');
  }
  const clock = await page.evaluate(() => Reflect.get(window, '__introClock') as { entered: number; spawned: number; keyed: number; moved: number; spawnZ: string });
  expect(clock.spawnZ).toBe('0.600');
  expect(clock.spawned - clock.entered, 'page ms from choosing Play to the spawn pose').toBeLessThan(400);
  expect(clock.moved - clock.keyed, 'page ms from W to the first step').toBeLessThan(400);
  expect(errors).toEqual([]);
});
