import { expect, test, type Page } from '@playwright/test';

// Real Next pages; only the API routes named below are intercepted to simulate a proxy outage or a dropped connection.
const badGateway = { status: 502, contentType: 'text/html', body: '<html><body>502 Bad Gateway</body></html>' };
const outage = 'Backroom is not responding right now (HTTP 502). Try again in a moment.';
const alert = (page: Page) => page.locator('main').getByRole('alert');

test('policy unlock explains an HTML 502 and a dropped connection instead of a JSON parse error', async ({ page }) => {
  let mode: 'html' | 'network' = 'html';
  await page.route('**/api/policy', route => mode === 'html' ? route.fulfill(badGateway) : route.abort('internetdisconnected'));
  await page.goto('/policy');
  await page.getByLabel('Owner PIN').fill('any-pin');
  await page.getByRole('button', { name: 'Unlock policy' }).click();
  await expect(alert(page)).toHaveText(outage);
  mode = 'network';
  await page.getByRole('button', { name: 'Unlock policy' }).click();
  await expect(alert(page)).toHaveText('Backroom could not be reached. Check the connection and try again.');
  await expect(page.getByLabel('Owner PIN')).toBeVisible();
});

test('audit wall explains an HTML 502 on unlock and recovers its poll after an outage', async ({ page }) => {
  let entries = 0;
  await page.route('**/api/session', route => route.fulfill(badGateway));
  await page.route('**/api/audit/entries', route => ++entries === 1
    ? route.fulfill({ status: 401, json: { error: 'Open the audit wall with your operator code.' } })
    : entries === 2 ? route.fulfill(badGateway)
    : route.fulfill({ json: { entries: [], chain: { valid: true, firstBrokenSeq: null, length: 0, headHash: '' }, measuredAt: new Date().toISOString() } }));
  await page.goto('/audit');
  await page.getByLabel('Operator code').fill('any-code');
  await page.getByRole('button', { name: 'Open audit wall' }).click();
  await expect(alert(page)).toContainText(outage);
  // A good unlock bumps the poll: first an outage, then the wall loads and the banner clears.
  await page.unroute('**/api/session');
  await page.route('**/api/session', route => route.fulfill({ json: { ok: true } }));
  await page.getByRole('button', { name: 'Open audit wall' }).click();
  // Prove the entries 502 itself was shown, not the stale session alert.
  await expect.poll(() => entries).toBeGreaterThanOrEqual(2);
  await expect(page.getByText('Loading audit records…')).toBeVisible();
  await expect(alert(page)).toContainText(outage);
  await expect(page.getByText('Chain verified · 0 entries', { exact: true })).toBeVisible({ timeout: 6000 });
  await expect(alert(page)).toHaveCount(0);
});
