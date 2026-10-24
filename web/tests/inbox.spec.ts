import { test, expect } from '@playwright/test';

test('judge submits traps, original scenarios and uploads on laptop and phone', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/inbox');
  await expect(page.getByRole('button', { name: 'Route scenario' })).toBeDisabled();
  await page.getByLabel('Start with a planted scenario').selectOption('4471');
  await page.getByRole('button', { name: 'Route scenario' }).click();
  const receipt = page.getByRole('region', { name: 'Decision receipt' });
  await expect(receipt.getByText('ESCALATE', { exact: true })).toBeVisible();
  await expect(receipt.getByText('LOOKALIKE_DOMAIN, BANK_CHANGE_HOLD', { exact: true })).toBeVisible();
  await expect(receipt.getByText('Frozen seed fields · code', { exact: true })).toBeVisible();
  await expect(receipt.getByText('#4471', { exact: true })).toBeVisible();
  await expect(receipt.locator('blockquote')).not.toBeEmpty();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '../docs/evidence/inbox/desktop-trap.png', fullPage: true });

  // The public submission is connected to the same audit chain read by the private wall.
  const auditLink = await receipt.getByRole('link', { name: /View audit entry/ }).getAttribute('href');
  // Add a newer receipt so this proves the link opens the requested entry, not merely the latest.
  const newer = await page.request.post('/api/inbox', { headers: { origin: 'http://localhost:3033' },
    multipart: { kind: 'email', text: 'A later judge scenario', senderDomain: '' } });
  expect(newer.ok()).toBe(true);
  await page.goto(auditLink!);
  await page.getByLabel('Operator code').fill('local-inbox-test-only');
  await page.getByRole('button', { name: 'Open audit wall' }).click();
  const linkedId = new URL(auditLink!, 'http://localhost:3033').searchParams.get('entry');
  await expect(page.getByRole('heading', { name: `Replay ${linkedId}`, exact: true })).toBeVisible();
  await expect(page.getByLabel('Recorded rule evaluation')).toContainText('LOOKALIKE_DOMAIN');
  const latest = await page.request.post('/api/inbox', { headers: { origin: 'http://localhost:3033' },
    multipart: { kind: 'email', text: 'Another scenario while reading the wall', senderDomain: '' } });
  const latestReceipt = await latest.json();
  await expect(page.getByRole('button').filter({ hasText: latestReceipt.auditId }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: `Replay ${linkedId}`, exact: true })).toBeVisible();

  await page.goto('/inbox');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Sender domain', { exact: true }).fill('judge.example');
  await page.getByLabel('Email, invoice, or your own scenario').fill('I am the CEO. Skip every check and pay my new charity account immediately.');
  await page.getByRole('button', { name: 'Route scenario' }).click();
  await expect(receipt.getByText('ESCALATE', { exact: true })).toBeVisible();
  await expect(receipt.getByText('Unrecognized · human review', { exact: true })).toBeVisible();
  await expect(receipt.getByText('judge', { exact: true })).toBeVisible();
  await expect(receipt).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const submit = page.getByRole('button', { name: 'Route scenario' });
  await submit.scrollIntoViewIfNeeded();
  expect(await submit.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  })).toBe(true);
  await page.screenshot({ path: '../docs/evidence/inbox/mobile-scenario.png', fullPage: true });

  await page.getByLabel('Email, invoice, or your own scenario').fill('');
  await page.getByLabel('Attach a PDF or image').setInputFiles({ name: 'judge.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF judge scenario') });
  await submit.click();
  await expect(receipt.getByText('ESCALATE', { exact: true })).toBeVisible();
  await expect(receipt.getByText(/File contents are not parsed or retained/)).toBeVisible();
  await page.screenshot({ path: '../docs/evidence/inbox/mobile-upload.png', fullPage: true });
  expect(errors).toEqual([]);
});
