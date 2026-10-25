import { test, expect, type Page } from '@playwright/test';

// Run via test:office:browser after building the web app.
/** The kiosk lives in the office panels drawer, closed by default. */
async function openPanels(page: Page) {
  const toggle = page.getByRole('button', { name: /^Office panels/ });
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('office lobby kiosk shows the authorized payment link', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/pay/active', route => route.fulfill({ json: { active: {
    code: 'ABCDEF1234', url: 'https://demo.example/p/ABCDEF1234', amountCents: 247500, expiresAt: Date.now() + 600_000, qr: PIXEL,
    bankLine: 'Mock bank (offline) · simulated card',
  } } }));
  await page.goto('/office?view=overview');
  await openPanels(page);
  const kiosk = page.locator("[data-office-mount='payment-link']");
  await expect(kiosk).toHaveAttribute('aria-label', 'Payment link kiosk');
  await expect(kiosk.getByRole('heading', { name: 'Scan to pay' })).toBeVisible();
  await expect(kiosk.getByText('ABCDEF1234', { exact: true })).toBeVisible();
  await expect(kiosk.getByRole('link', { name: 'https://demo.example/p/ABCDEF1234' })).toHaveAttribute('href', 'https://demo.example/p/ABCDEF1234');
  await expect(kiosk.getByRole('img', { name: 'Scan to open your authorized payment page' })).toBeVisible();
  await expect(kiosk).toContainText('$2,475.00');
  await expect(kiosk.getByText('Mock bank (offline) · simulated card', { exact: true })).toBeVisible();
  // Phone width: the kiosk and its QR fit the viewport instead of forcing horizontal scroll.
  await page.setViewportSize({ width: 360, height: 800 });
  const card = await kiosk.boundingBox();
  const qr = await kiosk.getByRole('img').boundingBox();
  expect(card!.x + card!.width).toBeLessThanOrEqual(360);
  expect(qr!.x + qr!.width).toBeLessThanOrEqual(card!.x + card!.width + 0.5);
  expect(await kiosk.evaluate(element => [...element.querySelectorAll('*')].every(child => child.scrollWidth <= child.clientWidth + 1 || !child.clientWidth))).toBe(true);
  expect(errors).toEqual([]);
});

test('office lobby kiosk labels a loopback rehearsal link', async ({ page }) => {
  await page.route('**/api/pay/active', route => route.fulfill({ json: { active: {
    code: 'ABCDEF1234', url: 'http://127.0.0.1:3300/p/ABCDEF1234', amountCents: 247500, expiresAt: Date.now() + 600_000, qr: PIXEL, localOnly: true,
  } } }));
  await page.goto('/office?view=overview');
  await openPanels(page);
  const kiosk = page.locator("[data-office-mount='payment-link']");
  await expect(kiosk.getByText('local rehearsal only, not scannable by a phone')).toBeVisible();
  await expect(kiosk.getByRole('link', { name: 'http://127.0.0.1:3300/p/ABCDEF1234' })).toBeVisible();
});

test('office lobby kiosk waits when no payment is authorized', async ({ page }) => {
  await page.route('**/api/pay/active', route => route.fulfill({ json: { active: null } }));
  await page.goto('/office?view=overview');
  await openPanels(page);
  const kiosk = page.locator("[data-office-mount='payment-link']");
  await expect(kiosk.getByRole('heading', { name: 'Scan to pay' })).toBeVisible();
  await expect(kiosk.getByRole('status')).toHaveText('Waiting for an authorized payment plan…');
  await expect(kiosk.getByRole('img')).toHaveCount(0);
});
