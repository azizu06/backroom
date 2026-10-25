import { expect, test } from '@playwright/test';
test('mobile sandbox pay page uses fixed ALLOW amount, posts once, and reloads its receipt', async ({ page }, testInfo) => {
  await page.goto('/pay/payment-demo-1042');
  // The fixture bank already holds an earlier reset's invoice 1042 deposit; it must not block this link.
  await expect(page.getByRole('button', { name: 'Pay $2,475.00', exact: true })).toBeEnabled();
  await expect(page.getByText(/Deposit needs review/)).toHaveCount(0);
  await expect(page.getByText('Offline bank; no card is charged.', { exact: true })).toBeVisible();
  await expect(page.locator('input')).toHaveCount(0);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: testInfo.outputPath('pay-mobile-before.png'), fullPage: true });
  await page.getByRole('button', { name: 'Pay $2,475.00', exact: true }).click();
  await expect(page.getByText('Payment matched. Invoice partially paid.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deposit recorded', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Offline bank balance + posted deposits' })).toBeVisible();
  await expect(page.getByText('Deposit reference: fake-deposit-2')).toBeVisible();
  const plan = page.getByRole('region', { name: 'Invoice #1042 payment plan' });
  await expect(plan.getByText('Paid $2,475.00 of $4,950.00 · Remaining $2,475.00', { exact: true })).toBeVisible();
  await expect(plan.getByRole('row')).toHaveText([/Installment.*Amount.*Due.*Status/, /^1 of 2\$2,475\.00.*Paid$/, /^2 of 2\$2,475\.00.*Upcoming$/]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Deposit recorded', exact: true })).toBeDisabled();
  await expect(plan.getByText('Paid $2,475.00 of $4,950.00 · Remaining $2,475.00', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('pay-mobile-after.png'), fullPage: true });
  await page.getByRole('button', { name: 'Refresh payment status', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('pay-mobile-bank-readback.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: testInfo.outputPath('pay-desktop-after.png'), fullPage: true });
});
test('unknown link cannot pay', async ({ page }) => {
  await page.goto('/pay/nonexistent');
  await expect(page.locator('main [role=alert]')).toHaveText('This payment link is unavailable.');
  await expect(page.getByRole('button', { name: /^Pay / })).toHaveCount(0);
});
