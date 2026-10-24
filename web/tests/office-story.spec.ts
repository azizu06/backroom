import { test, expect } from '@playwright/test';

test('judge story can advance and exit with Escape', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?demo=story');
  const story = page.getByRole('complementary', { name: 'Judge story mode' });
  await expect(story.locator('.story-disclaimer')).toContainText('Scripted walkthrough · illustration, not recorded decisions');
  await expect(story.locator('.story-kicker')).toContainText(/Chapter 1 of/);
  await expect(story).toContainText('In the demo, invoices and emails enter one queue for review.');
  await expect(story.locator('.story-evidence')).toHaveText('Not recorded in this session');
  await expect(story.locator('[aria-live]')).toHaveText(/^Scripted walkthrough:/);
  await story.getByRole('button', { name: 'Next' }).click();
  await expect(story.locator('.story-kicker')).toContainText(/Chapter 2 of/);
  await page.keyboard.press('Escape');
  await expect(story).toHaveCount(0);
  expect(errors).toEqual([]);
});
