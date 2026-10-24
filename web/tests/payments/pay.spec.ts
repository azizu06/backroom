import { expect, test } from '@playwright/test';
test('mobile sandbox pay page uses fixed ALLOW amount, posts once, and reloads its receipt', async ({ page }, testInfo) => {
  await page.goto('/pay/payment-demo-1042');
  await expect(page.getByRole('button', { name: 'Pay $2,475.00 with simulated card', exact: true })).toBeVisible();
  await expect(page.getByText('Nessie = sandbox bank; simulated card.', { exact: true })).toBeVisible();
  await expect(page.locator('input')).toHaveCount(0);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.screenshot({ path: testInfo.outputPath('pay-mobile-before.png'), fullPage: true });
  await page.getByRole('button', { name: 'Pay $2,475.00 with simulated card', exact: true }).click();
  await expect(page.getByText('Payment matched. Invoice partially paid.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Deposit recorded', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Nessie account balance + Nessie-reported posted deposits' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Deposit recorded', exact: true })).toBeDisabled();
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
