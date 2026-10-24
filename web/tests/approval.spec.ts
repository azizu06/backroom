import { test, expect } from '@playwright/test';

// No provider network: an opt-in fixture call and Chromium's virtual authenticator.
test('Dana registers, reviews evidence and relays Deny / Approve / Counter with real passkey verification', async ({ page, request }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto('/controller');
  await page.getByLabel('Controller enrollment code').fill('local-browser-test-only');
  await page.getByRole('button', { name: 'Create Dana’s passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Dana’s passkey is ready.' })).toBeVisible();
  let seq = 0;
  async function tool(name: string, extra: Record<string, unknown>) {
    const res = await request.post(`/api/tools/${name}`, { headers: { authorization: 'Bearer local-tool-test-only' },
      data: { call_id: 'approval-demo', webhook_request_id: `browser-${++seq}`, ...extra } });
    expect(res.ok()).toBe(true);
    return res.json();
  }
  for (const kind of ['Deny', 'Approve', 'Counter']) {
    const started = Date.now();
    const proposed = await tool('propose_plan', { installments: 4, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
    expect(proposed.kind).toBe('ESCALATE');
    expect(Date.now() - started).toBeLessThan(1000);
    const id = proposed.escalation_id;
    const forged = await request.post(`/api/approvals/${id}/decide`, { headers: { origin: 'http://localhost:3020' },
      data: { challengeId: 'fake', response: { method: 'passkey', verified: true } } });
    expect(forged.status()).toBe(403);
    await page.goto(proposed.approval_path);
    await expect(page.getByRole('heading', { name: 'Requested terms' })).toBeVisible();
    await expect(page.getByText('$4,950.00', { exact: true })).toBeVisible();
    await expect(page.getByText('MAX_INSTALLMENTS', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (kind === 'Deny') await page.screenshot({ path: 'test-results/approval-mobile.png', fullPage: true });
    const sent = page.waitForRequest(r => r.url().endsWith('/decide') && r.method() === 'POST');
    if (kind === 'Counter') {
      await page.getByRole('button', { name: 'Offer a counter' }).click();
      await page.getByLabel('Payments', { exact: true }).fill('3');
      await page.getByRole('button', { name: 'Confirm counter with passkey' }).click();
    } else await page.getByRole('button', { name: `${kind} with passkey` }).click();
    const assertion = await sent;
    const verified = await assertion.response();
    expect(await verified?.json()).toMatchObject({ escalation: { method: 'passkey' } });
    await expect(page.getByRole('heading', { name: 'Your decision is recorded.' })).toBeVisible();
    const replay = await request.post(assertion.url(), { headers: { origin: 'http://localhost:3020' }, data: assertion.postDataJSON() });
    expect(replay.status()).toBe(403);
    const checked = await tool('check_approval', { escalation_id: id });
    expect(checked.approval_status).toBe(kind === 'Deny' ? 'denied' : kind === 'Approve' ? 'approved' : 'counter');
    expect(checked.can_confirm).toBe(false);
    expect(checked.decision.kind).toBe(kind);
    if (kind === 'Counter') expect(checked.counter_terms.installments).toBe(3);
  }
  await cdp.detach();
});
