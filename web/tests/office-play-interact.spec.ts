import { expect, test, type Page } from '@playwright/test';

const surface = (page: Page) => page.getByRole('application', { name: /First-person office/ });
const prompt = (page: Page) => page.locator('.play-prompt');

async function start(page: Page, spawn: string) {
  await page.goto(`/office?view=overview&playSpawn=${spawn}`);
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-yaw', /\d/);
}

/** Stop a turn on the rendering frame that crosses the desired heading. */
async function turnAround(page: Page) {
  const initial = await surface(page).getAttribute('data-player-yaw');
  await page.keyboard.down('ArrowLeft');
  try {
    await page.waitForFunction(start => {
      const yaw = Number(document.querySelector<HTMLElement>('[data-player-yaw]')?.dataset.playerYaw);
      return Math.abs(Math.atan2(Math.sin(yaw - Number(start)), Math.cos(yaw - Number(start)))) > 3;
    }, initial, { polling: 'raf' });
  } finally { await page.keyboard.up('ArrowLeft'); }
}

/** Door aiming needs to enter its pick cone; walking still needs a square heading. */
async function face(page: Page, x: number, z: number, tolerance = 0.08) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const { yaw, diff } = await surface(page).evaluate((element, point) => {
      const { playerX, playerZ, playerYaw } = (element as HTMLElement).dataset;
      const yaw = Number(playerYaw);
      const raw = Math.atan2(-(point.x - Number(playerX)), -(point.z - Number(playerZ))) - yaw;
      return { yaw, diff: Math.atan2(Math.sin(raw), Math.cos(raw)) };
    }, { x, z });
    if (Math.abs(diff) <= tolerance) return;
    const key = diff > 0 ? 'ArrowLeft' : 'ArrowRight';
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
  throw new Error('Could not face the door leaf');
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  for (const side of ['front', 'back'] as const) {
    test(`interior door starts open, closes to block walking and reopens (${reducedMotion}, ${side})`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.emulateMedia({ reducedMotion });
      // Stand beside the frame and deliberately face the swung-open leaf, from either side.
      await start(page, side === 'front' ? '-0.15,0' : '-0.15,-1.05');
      await face(page, -0.65, 0, 0.2);
      await expect(prompt(page)).toHaveText('E · Close door');
      await expect(page.getByTestId('office-door-payables')).toHaveText('Payables door open');
      await page.keyboard.press('e');
      await face(page, 0, -0.65, 0.2);
      await expect(prompt(page)).toHaveText('E · Open door');
      await expect(page.getByTestId('office-door-payables')).toHaveText('Payables door closed');
      // Walk squarely into the leaf so a diagonal heading cannot slide along the barrier.
      await face(page, -0.15, side === 'front' ? -3 : 2);
      await page.keyboard.down('w');
      try {
        const barrier = side === 'front' ? -0.31 : -0.99;
        await expect.poll(async () => Math.abs(Number(await surface(page).getAttribute('data-player-z')) - barrier)).toBeLessThan(0.02);
        await page.waitForTimeout(300);
        const stopped = Number(await surface(page).getAttribute('data-player-z'));
        if (side === 'front') expect(stopped).toBeGreaterThan(-0.32);
        else expect(stopped).toBeLessThan(-0.98);
      } finally { await page.keyboard.up('w'); }
      await face(page, 0, -0.65, 0.2);
      await page.keyboard.press('e');
      await face(page, -0.65, 0, 0.2);
      await expect(prompt(page)).toHaveText('E · Close door');
      await expect(page.getByTestId('office-door-payables')).toHaveText('Payables door open');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await face(page, 0, side === 'front' ? -3 : 2);
      await page.keyboard.down('w');
      try {
        await page.waitForFunction(side => {
          const z = Number(document.querySelector<HTMLElement>('[data-player-z]')?.dataset.playerZ);
          return side === 'front' ? z < -1.05 : z > -0.25;
        }, side, { polling: 'raf' });
      } finally { await page.keyboard.up('w'); }
      expect(errors).toEqual([]);
    });
  }
}

test('folder is held locally, world prompts take priority, and it can be put down and picked up again', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await start(page, '-4.4,4.45');
  await expect(prompt(page)).toHaveText('E · Pick up folder');
  await page.keyboard.press('e');
  await expect(page.getByTestId('office-carry-folder')).toHaveText('Held invoice folder');
  await expect(prompt(page)).toHaveText('E · Scan to pay · payment link kiosk');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await turnAround(page);
  await expect(prompt(page)).toHaveText('E · Put down folder');
  expect(await prompt(page).evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.keyboard.press('e');
  await expect(page.getByTestId('office-carry-folder')).toHaveText('Invoice folder on surface');
  await expect(prompt(page)).toHaveText('E · Pick up folder');
  await page.keyboard.press('e');
  await expect(page.getByTestId('office-carry-folder')).toHaveText('Held invoice folder');
  expect(errors).toEqual([]);
});
