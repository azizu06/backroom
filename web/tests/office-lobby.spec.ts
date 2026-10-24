import { test, expect } from '@playwright/test';

// Preview office (STATE_STORE=memory) on a production build, started with the audit test env, e.g.
//   WEBAUTHN_ORIGIN=http://localhost:3033 WEBAUTHN_RP_ID=localhost CONTROLLER_ENROLLMENT_SECRET=local-audit-test-only \
//   TOOL_GATEWAY_SECRET=local-tool-test-only OPENROUTER_API_KEY= pnpm exec next start --port 3033
//   OFFICE_LOBBY_URL=http://localhost:3033 pnpm exec playwright test tests/office-lobby.spec.ts
const base = process.env.OFFICE_LOBBY_URL ?? 'http://localhost:3033';
const code = process.env.OFFICE_LOBBY_OPERATOR_CODE ?? 'local-audit-test-only';
test.use({ baseURL: base, viewport: { width: 1440, height: 1000 } });

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
  expect(errors).toEqual([]);
});
