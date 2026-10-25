import { expect, test } from '@playwright/test';

test('owner edits badge limits and subsequent gateway decisions use v2 with immutable v1 evidence', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  const origin = 'http://localhost:3034';
  const offer = async (id: string, installments = 3) => {
    const res = await request.post('/api/tools/propose_plan', {
      headers: { authorization: 'Bearer local-tool-test-only' },
      data: { call_id: 'approval-demo', webhook_request_id: id, installments, first_payment_pct: 50,
        duration_days: 30, waive_fee: false, discount_pct: 0 },
    });
    expect(res.ok()).toBe(true);
    return res.json();
  };
  expect((await request.get('/api/policy')).status()).toBe(401);
  expect((await offer('policy-before')).kind).toBe('ESCALATE');
  await page.goto('/policy');
  await page.getByLabel('Owner PIN').fill('local-owner-pin-only');
  await page.getByRole('button', { name: 'Unlock policy' }).click();
  await expect(page.getByText('Saved policy v1', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Maximum installments', { exact: true })).toHaveValue('2');
  await page.screenshot({ path: '../docs/evidence/policy-editor/v1.png', fullPage: true });
  const count = page.getByLabel('Maximum installments', { exact: true });
  await count.fill('0');
  await page.getByRole('button', { name: 'Save as v2' }).click();
  expect(await count.evaluate((e: HTMLInputElement) => e.validity.valid)).toBe(false);
  await expect(page.getByText('Saved policy v1', { exact: true })).toBeVisible();
  await count.fill('3');
  await page.getByRole('button', { name: 'Save as v2' }).click();
  await expect(page.getByRole('status')).toContainText('Saved v2. New decisions use these limits.');
  await expect(count).toHaveValue('3');
  expect((await offer('policy-after')).kind).toBe('ALLOW');
  const four = await offer('policy-over', 4);
  expect(four.kind).toBe('ESCALATE');
  const snapshot = await request.get(`/api/approvals/${four.escalation_id}/view`);
  expect(await snapshot.json()).toMatchObject({ escalation: { policyVersion: 2, quote: { text: expect.stringContaining('3 in v2') } } });
  await page.screenshot({ path: '../docs/evidence/policy-editor/v2.png', fullPage: true });
  await page.getByRole('button', { name: 'Lock editor' }).click();
  await expect(page.getByLabel('Owner PIN')).toHaveValue('');
  await page.reload();
  await page.getByLabel('Owner PIN').fill('local-owner-pin-only');
  await page.getByRole('button', { name: 'Unlock policy' }).click();
  await expect(page.getByText('Saved policy v2', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const save = page.getByRole('button', { name: 'Save as v3' });
  await save.scrollIntoViewIfNeeded();
  expect(await save.evaluate(element => {
    const r = element.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
  await page.screenshot({ path: '../docs/evidence/policy-editor/mobile.png', fullPage: true });

  const session = await request.post('/api/session', { headers: { origin }, data: { code: 'local-policy-audit-only' } });
  expect(session.ok()).toBe(true);
  const audit = await (await request.get('/api/audit/entries')).json();
  expect(audit.chain.valid).toBe(true);
  expect(audit.entries.filter((e: { action: string }) => e.action === 'propose_plan').map((e: { policyVersion: number; decision: string }) => [e.policyVersion, e.decision])).toEqual([[1, 'ESCALATE'], [2, 'ALLOW'], [2, 'ESCALATE']]);
  expect(audit.entries.find((e: { action: string }) => e.action === 'save_policy')).toMatchObject({ actor: 'human', policyVersion: 2, inputs: { method: 'demo_pin', previousVersion: 1 } });
  expect(errors).toEqual([]);
});
