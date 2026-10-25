import { test, expect, type Page } from '@playwright/test';
import { navLinks, whatsRealLink } from '../lib/site-nav';

// Every page outside /pay is reached by clicking; nobody types a path.
const titles: Record<string, string> = {
  '/calls': 'Office Calls', '/inbox': 'Inbox', '/audit': 'Audit Wall', '/attack': 'Try to Trick the Agents', '/policy': 'Owner Policy',
  '/controller': 'Dana’s Controller', '/payment-link': 'Call Payment Link', '/operator': 'Operator Console', '/real-vs-sim': 'System Status',
};
const navLink = (page: Page, label: string) => page.getByRole('navigation', { name: 'Site' })
  .getByRole('link', { name: new RegExp(`^${label}( · ready)?$`) });

test('the site nav walks from the home page to every page and back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  // Home is the office; its splash keeps the nav inert until the visitor picks a view.
  const splash = page.getByRole('dialog', { name: 'Backroom' });
  await expect(splash).toBeVisible();
  await splash.getByRole('button', { name: 'Overview (map view)' }).click();
  await expect(splash).toHaveCount(0);
  for (const { href, label } of [...navLinks.filter(link => link.href !== '/office'), whatsRealLink]) {
    await navLink(page, label).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(titles[href]!);
    await expect(page.getByRole('navigation', { name: 'Site' })).toHaveCount(1);
    await expect(navLink(page, label)).toHaveAttribute('aria-current', 'page');
  }
  await navLink(page, 'Office').click();
  await expect(page).toHaveURL(/\/office$/);
  expect(errors).toEqual([]);
});

test('a live payment link shows on the calls page with a Pay button and lights up the nav', async ({ page }) => {
  const qr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  await page.route('**/api/pay/active', route => route.fulfill({ json: { active: {
    code: 'ABCDEF1234', url: 'http://localhost:3031/p/ABCDEF1234', amountCents: 247500, expiresAt: Date.now() + 600_000, qr } } }));
  await page.goto('/inbox');
  await expect(navLink(page, 'Payment Link')).toHaveText('Payment Link · ready');
  await navLink(page, 'Calls').click();
  const panel = page.getByRole('region', { name: 'Call payment link' });
  await expect(panel.getByRole('heading', { name: 'Payment link ready' })).toBeVisible();
  await expect(panel.getByRole('img', { name: 'Scan to open your authorized payment page' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Pay $2,475.00' })).toHaveAttribute('href', 'http://localhost:3031/p/ABCDEF1234');
});

test('the calls page stays quiet while no payment link is live', async ({ page }) => {
  await page.route('**/api/pay/active', route => route.fulfill({ json: { active: null } }));
  await page.goto('/calls');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Office calls');
  await expect(page.getByRole('region', { name: 'Call payment link' })).toHaveCount(0);
  await expect(navLink(page, 'Payment Link')).toHaveText('Payment Link');
});
