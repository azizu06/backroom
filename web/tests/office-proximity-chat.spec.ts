import { test, expect, type Page } from '@playwright/test';

// Run via test:office:browser after building the web app. Needs WebGL (Play renders the 3D scene).
const FAR = { x: 5, z: 0.6 }; // Corridor by the Treasury, 14 m from the spawn (-9, 0.6).

function surface(page: Page) {
  return page.getByRole('application', { name: /First-person office/ });
}
function chatLog(page: Page) {
  return page.getByRole('log', { name: 'Proximity chat messages' });
}
async function enterPlay(page: Page, url: string) {
  await page.goto(url);
  const available = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  if (!available) throw new Error('WebGL is unavailable in this headless Chromium, so the first-person Play view cannot render.');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
}
async function say(page: Page, text: string) {
  await surface(page).focus();
  await page.keyboard.press('t');
  const field = page.getByRole('textbox', { name: /Message viewers within 6 m/ });
  await expect(field).toBeFocused();
  await field.fill(text);
  await page.keyboard.press('Enter');
  await expect(field).toBeHidden();
  await expect(chatLog(page)).toContainText(text);
}

test('proximity chat reaches a coworker in range and is dropped out of range', async ({ browser }) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  const b = await context.newPage();
  const errors: string[] = [];
  for (const page of [a, b]) page.on('pageerror', error => errors.push(error.message));

  await enterPlay(a, '/office?presence=1&view=overview');
  await enterPlay(b, '/office?presence=1&view=overview');
  // The presence chip lives in the corner menu, which steps aside in first person: the count is still kept.
  await expect(a.getByText('2 viewing')).toBeAttached({ timeout: 8000 });

  // Both at the lobby spawn: within PROXIMITY_RADIUS.
  await say(a, 'hello from A');
  await expect(chatLog(b)).toContainText('hello from A', { timeout: 5000 });

  // A re-enters Play 10 m away (test-only spawn), then speaks again.
  await enterPlay(a, `/office?presence=1&view=overview&playSpawn=${FAR.x},${FAR.z}`);
  await expect.poll(async () => Number(await surface(a).getAttribute('data-player-x'))).toBeCloseTo(FAR.x, 1);
  await say(a, 'too far to hear');
  await b.waitForTimeout(1500);
  await expect(chatLog(b)).not.toContainText('too far to hear');
  await expect(chatLog(b)).toContainText('hello from A');

  expect(errors).toEqual([]);
  await context.close();
});

test('play chat offers Show coworkers when presence is off', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterPlay(page, '/office?view=overview');
  const chat = page.getByRole('region', { name: 'Proximity chat' });
  // Diegetic HUD: the closed chat shows nothing on screen; T opens it and offers Show coworkers there.
  await surface(page).focus();
  await page.keyboard.press('t');
  await chat.getByRole('button', { name: 'Show coworkers' }).click();
  await expect(page.getByLabel('Show viewers')).toBeChecked();
  await expect(page.getByRole('textbox', { name: /Message viewers within 6 m/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(surface(page)).toBeFocused();
  expect(errors).toEqual([]);
});
