import { test, expect } from '@playwright/test';

// These are the existing scene-text accessibility hooks for the in-world texture, not HUD overlays.
test('scripted handoff shows a sender bubble followed by the receiver reply', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?handoffs=mock&view=overview');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  const sender = page.getByTestId('agent-chat-intake-sender');
  const receiver = page.getByTestId('agent-chat-extractor-reply');
  await expect(sender).toContainText('Scripted · Intake: Passing INV-1042 to Extractor.', { timeout: 20_000 });
  await expect(sender).toContainText('Status: Passing documents');
  await expect(receiver).toHaveCount(0);
  await expect(receiver).toContainText('Scripted · Extractor: Got it.', { timeout: 20_000 });
  await expect(receiver).toContainText(/Status: (Reviewing documents|Turn finished)/);
  expect(errors).toEqual([]);
});

test('reduced motion still shows the in-world conversation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/office?handoffs=mock&handoffSpeed=4&view=overview');
  await expect(page.getByTestId('agent-chat-intake-sender')).toContainText('Passing INV-1042 to Extractor.', { timeout: 20_000 });
  await expect(page.getByTestId('agent-chat-extractor-reply')).toContainText('Got it.', { timeout: 20_000 });
  await expect(page.locator('.handoff-tag[data-returning="true"]')).toHaveCount(0);
});
