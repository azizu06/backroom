import { test, expect } from '@playwright/test';

// Run via test:office:browser after building the web app.
const code = process.env.OFFICE_LOBBY_OPERATOR_CODE ?? 'local-audit-test-only';
if (process.env.OFFICE_LOBBY_URL) test.use({ baseURL: process.env.OFFICE_LOBBY_URL });

test('office lobby mounts the live audit wall and ask-why without breaking the office layout', async ({ page }) => {
  const errors: string[] = [], audit: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/audit/')) audit.push(path); });
  await page.goto('/office');
  await expect(page.locator('.office-toolbar')).toBeVisible();
  await expect(page.getByTestId('office-viewport')).toBeVisible();
  const lobby = page.locator('#office-audit-wall');
  await expect(lobby).toHaveAttribute('data-office-mount', 'audit-wall');
  await expect(lobby.locator('[data-audit-id]')).toHaveCount(0);
  await expect(lobby).not.toContainText('Preview receipts');
  await lobby.getByLabel('Operator code').fill(code);
  await lobby.getByRole('button', { name: 'Open audit wall' }).click();
  await expect(lobby.getByText(/^Chain verified · \d+ entries$/)).toBeVisible();
  expect(audit).toContain('/api/audit/entries');
  await expect(lobby.getByRole('heading', { name: 'Audit wall', exact: true, level: 3 })).toBeVisible();
  await expect(lobby.locator('.audit-why')).toHaveCount(0);
  const ask = lobby.getByRole('region', { name: 'Ask why by voice' });
  await expect(ask.getByRole('button', { name: 'Hold to ask why' })).toBeVisible();
  await expect(ask.getByRole('button', { name: 'Ask why', exact: true })).toBeDisabled();
  // The full-page wall is constrained inside the footer, left of the RealVsSim panel spacing.
  const viewport = await page.getByTestId('office-viewport').boundingBox();
  const wall = await lobby.locator('.audit-wall').boundingBox();
  const footer = await page.locator('.office-footer').boundingBox();
  expect(viewport!.height).toBeGreaterThan(400);
  expect(wall!.height).toBeLessThanOrEqual(900);
  expect(wall!.x + wall!.width).toBeLessThanOrEqual(footer!.x + footer!.width - 680);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Preview Treasury denial' }).click();
  const previewReceipts = page.getByRole('region', { name: 'Preview audit receipts' });
  await expect(previewReceipts).toContainText('DENY');
  // Fixture rows stay out of the server-record lobby wall (its own rows may carry data-audit-id).
  const denialId = await previewReceipts.locator('[data-audit-id]').first().getAttribute('data-audit-id');
  await expect(lobby.locator(`[data-audit-id="${denialId}"]`)).toHaveCount(0);
  await expect(lobby).not.toContainText('Preview receipts');
  expect(errors).toEqual([]);
});

test('office ask-why pauses on a broken chain and resumes when verified', async ({ page }) => {
  let valid = false;
  await page.route('**/api/audit/entries', route => route.fulfill({ json: {
    entries: [], chain: { valid, length: 0, ...(valid ? {} : { firstBrokenSeq: 1, reason: 'hash mismatch' }) },
    measuredAt: '2026-10-24T12:00:00Z',
  } }));
  await page.goto('/office');
  const lobby = page.locator('#office-audit-wall');
  const ask = lobby.getByRole('region', { name: 'Ask why by voice' });
  await expect(ask).toContainText('The audit chain is broken');
  await expect(ask.getByRole('button', { name: 'Hold to ask why' })).toBeDisabled();
  await expect(ask.getByRole('textbox')).toBeDisabled();
  await expect(ask.getByRole('button', { name: 'Ask why', exact: true })).toBeDisabled();
  await expect(lobby.locator('.audit-why')).toHaveCount(0);
  valid = true;
  await expect(ask.getByRole('button', { name: 'Hold to ask why' })).toBeEnabled();
  await expect(ask.getByRole('textbox')).toBeEnabled();
  await expect(ask).not.toContainText('The audit chain is broken');
  await page.route('**/api/why', route => route.fulfill({ status: 409, json: { error: 'AUDIT_CHAIN_BROKEN' } }));
  await ask.getByRole('textbox').fill('Why was payment paused?');
  await ask.getByRole('button', { name: 'Ask why', exact: true }).click();
  await expect(ask.getByRole('alert')).toContainText('The audit chain is broken');
  await expect(ask.getByRole('alert')).toContainText('AUDIT_CHAIN_BROKEN');
});
