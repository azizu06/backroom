import { test, expect } from '@playwright/test';
import { verifyChain, type AuditEntry } from '@backroom/orchestrator';

// Real Next routes, canonical chain, policy engine and gateway. No model/bank/voice calls.
test('private audit wall updates, replays and cites decisions on laptop and phone; tampering turns the badge red', async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/audit');
  await page.getByLabel('Operator code').fill('local-audit-test-only');
  await page.getByRole('button', { name: 'Open audit wall' }).click();
  await expect(page.getByText('Chain verified · 0 entries', { exact: true })).toBeVisible();
  await expect(page.getByText(/^No decisions in this run yet/)).toBeVisible();
  const tool = async (id: string, terms: Record<string, unknown>) => {
    const result = await request.post('/api/tools/propose_plan', { headers: { authorization: 'Bearer local-tool-test-only' },
      data: { call_id: 'approval-demo', webhook_request_id: id, installments: 4, first_payment_pct: 50,
        duration_days: 30, waive_fee: false, discount_pct: 0, ...terms } });
    expect(result.ok()).toBe(true);
    return result.json();
  };
  expect((await tool('audit-escalate', {})).kind).toBe('ESCALATE');
  await expect(page.getByText('Chain verified · 2 entries', { exact: true })).toBeVisible();
  // Default view: one story per call, readable lines, the raw list closed.
  const story = page.locator('.audit-story[data-kind=call]');
  await expect(story.getByRole('heading', { name: /^Call (with|about)/ })).toBeVisible();
  await expect(story.locator('.audit-line').filter({ hasText: '4-payment plan proposed, over the badge limit' })).toContainText('MAX_INSTALLMENTS');
  await expect(page.getByRole('heading', { name: 'Recorded actions' })).toBeHidden();
  expect((await tool('audit-deny', { installments: 2, waive_fee: true })).kind).toBe('DENY');
  await expect(page.getByText('Chain verified · 3 entries', { exact: true })).toBeVisible();
  await expect(story.locator('.audit-line[data-proof=deny]')).toContainText('FEES_NON_WAIVABLE');
  await story.getByRole('button', { name: /^Ask why: 4-payment plan/ }).click();
  await expect(page.getByLabel('Question about a decision')).toHaveValue('Why was invoice 1042 escalated to Dana under MAX_INSTALLMENTS?');
  await expect(page.getByText('Recorded facts · code fallback', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('stories.png'), fullPage: true });

  // Show all entries keeps the full chain, raw inputs and hashes.
  await page.getByText(/^Show all entries/).click();
  const all = page.locator('.audit-advanced');
  await expect(all.getByRole('button', { name: /create escalation/ })).toContainText('via');
  const denied = all.getByRole('button', { name: /DENY/ });
  await expect(denied).toContainText('FEES_NON_WAIVABLE');
  await expect(denied.locator('.audit-quote')).not.toContainText('not recorded');
  await denied.click();
  await expect(page.getByRole('heading', { name: /^Replay / })).toBeVisible();
  await expect(page.getByLabel('Recorded rule evaluation')).toContainText('FEES_NON_WAIVABLE');
  await page.getByLabel('Question about a decision').fill('Why was invoice 1042 escalated?');
  await page.getByRole('button', { name: 'Explain decision' }).click();
  await expect(page.getByText('Recorded facts · code fallback', { exact: true })).toBeVisible();
  const citation = page.locator('.audit-citations a').nth(1);
  const id = await citation.innerText();
  await citation.click();
  await expect(page.getByRole('heading', { name: `Replay ${id}`, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Question about a decision').fill('Why invoice 999999?');
  await page.getByRole('button', { name: 'Explain decision' }).click();
  await expect(page.getByText('No matching evidence', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.audit-why').scrollIntoViewIfNeeded();
  // The always-visible real-vs-sim panel must leave the submit control reachable.
  const button = page.getByRole('button', { name: 'Explain decision' });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  const clear = await button.evaluate(element => {
    const r = element.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return top === element || element.contains(top);
  });
  expect(clear).toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });

  // Change one byte of a real API snapshot, then use the real verifier. No write/tamper endpoint exists.
  await page.route('**/api/audit/entries', async route => {
    const response = await route.fetch();
    const body = await response.json() as { entries: AuditEntry[]; chain: ReturnType<typeof verifyChain> };
    body.entries[0]!.inputs!.invoiceId = 'tampered';
    body.chain = verifyChain(body.entries);
    await route.fulfill({ response, json: body });
  });
  await expect(page.getByText('Chain broken · first broken seq 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explain decision' })).toBeDisabled();
  const colors = await page.locator('.audit-chain').evaluate(element => {
    const style = getComputedStyle(element);
    const token = document.createElement('span');
    token.style.backgroundColor = 'var(--danger-soft)';
    element.append(token);
    const expected = getComputedStyle(token).backgroundColor;
    token.remove();
    return { actual: style.backgroundColor, expected, ink: style.color };
  });
  expect(colors.actual).toBe(colors.expected);
  // The warning remains readable and visually distinct from the verified aqua badge.
  expect(colors.actual).not.toBe('rgb(163, 243, 255)');
  const contrast = (foreground: string, background: string) => {
    const luminance = (color: string) => color.match(/\d+/g)!.slice(0, 3).map(Number).map(n => {
      const v = n / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  expect(contrast(colors.ink, colors.actual)).toBeGreaterThanOrEqual(4.5);
  await expect(story.getByRole('button', { name: /^Ask why:/ }).first()).toBeDisabled();
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('tampered.png'), fullPage: true });
  expect(errors).toEqual([]);
});
