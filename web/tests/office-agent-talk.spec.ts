import { test, expect, type Page } from '@playwright/test';

// Run via test:office:browser after building the web app. Needs WebGL; fails loudly without it.
// Helpers mirror tests/office-play.spec.ts (Playwright specs here do not share modules).
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
/** The office has no ?view=play deep link, so select Play from the view picker like office-play.spec.ts. */
async function startPlay(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
  await requireWebGL(page);
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await select.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
  return errors;
}

test('walk up to Alex, press E and talk: greeting, quick replies, speech bubble', async ({ page }) => {
  const errors = await startPlay(page);
  const viewport = page.getByTestId('office-viewport');
  const prompt = page.getByText('E · Talk to Alex');
  await holdUntil(page, 'w', () => prompt.isVisible());
  await page.keyboard.press('e');

  const dialog = page.getByRole('dialog', { name: 'Talking with Alex' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Close/ })).toBeFocused();
  await expect(dialog.locator('.agent-talk-line')).toHaveText("“I'm Alex, collections. Right now: Reviewing invoice 1042 (Collections).”");
  const bubble = viewport.locator('[data-agent-tag="collections-clerk"] .agent-talk-bubble');
  await expect(bubble).toHaveText("I'm Alex, collections. Right now: Reviewing invoice 1042 (Collections).");

  const reply = dialog.locator('.agent-talk-reply');
  await expect(reply).toHaveAttribute('aria-live', 'polite');
  await dialog.getByRole('button', { name: /What are you working on\?/ }).click();
  await expect(reply).toContainText('Right now: Reviewing invoice 1042 (Collections).');

  await page.keyboard.press('2');
  await expect(reply).toContainText('Nothing in my record says I stopped.');
  await expect(bubble).toHaveText('Nothing in my record says I stopped.');
  await expect(dialog.getByRole('button', { name: /Why did you stop\?/ })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('3');
  await expect(reply).toContainText('Nobody is queued after me in my record.');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(bubble).toHaveCount(0);
  await expect(surface(page)).toBeFocused();
  expect(errors).toEqual([]);
});
