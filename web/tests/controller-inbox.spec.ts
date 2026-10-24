import { test, expect, type Page } from '@playwright/test';

// Counts chimes and vibrations without changing what the page does.
async function spyAlerts(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { chimes: number; vibrations: number };
    w.chimes = 0; w.vibrations = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) { w.chimes++; return start.apply(this, args); };
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => { w.vibrations++; return true; } });
  });
}
const alerts = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { chimes: number; vibrations: number };
  return { chimes: w.chimes, vibrations: w.vibrations };
});

test('a stubbed escalation rings and opens on /controller without anyone sharing a link', async ({ page }) => {
  await spyAlerts(page);
  const now = Date.now();
  const escalation = { id: 'stub-escalation-1', taskId: 'call:stub', callId: 'stub', fromAgent: 'collections-1', toHuman: 'Dana',
    ruleIds: ['MAX_INSTALLMENTS'], evidenceRefs: ['audit:stub', '1042'], status: 'pending', createdAt: now, expiresAt: now + 60_000,
    policyVersion: 1, quote: { sentenceId: 'NF-005', text: 'At most two installments; ask Dana for an exception.' },
    invoiceId: '1042', amountCents: 495000, principalCents: 480000, lateFeeCents: 15000, currency: 'USD',
    requestedTerms: { installments: 4, firstPaymentPct: 50, durationDays: 30, waiveFee: false, discountPct: 0 } };
  let polls = 0;
  await page.route('**/api/controller/view', route => route.fulfill({ json: { registered: true, signedIn: true } }));
  await page.route('**/api/controller/inbox', route => route.fulfill({ json: { escalations: ++polls < 3 ? [] : [escalation] } }));
  await page.route(`**/api/approvals/${escalation.id}/view`, route => route.fulfill({ json: { escalation, registered: true } }));
  await page.goto('/controller');
  await expect(page.getByRole('heading', { name: 'All clear.' })).toBeVisible();
  expect(await alerts(page)).toEqual({ chimes: 0, vibrations: 0 });
  await expect(page.getByRole('heading', { name: 'Approval needed' })).toBeVisible({ timeout: 6000 });
  await expect(page.getByText('$4,950.00', { exact: true })).toBeVisible();
  await expect(page.getByText('MAX_INSTALLMENTS', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve with passkey' })).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe('/controller');
  await expect(page).toHaveTitle('(1) Approval needed · Backroom');
  const rang = await alerts(page);
  expect(rang.chimes).toBeGreaterThan(0);
  expect(rang.vibrations).toBe(1);
  // Later polls of the same request do not ring again.
  await page.waitForTimeout(3200);
  expect(await alerts(page)).toEqual(rang);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Dana signs in once; a live escalation appears by itself, a forged decision is rejected, and her passkey decides', async ({ page, request }) => {
  await spyAlerts(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto('/controller');
  await page.getByLabel('Controller enrollment code').fill('local-browser-test-only');
  await page.getByRole('button', { name: 'Create Dana’s passkey' }).click();
  await expect(page.getByRole('heading', { name: 'Dana’s passkey is ready.' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with passkey' }).click();
  await expect(page.getByRole('heading', { name: 'All clear.' })).toBeVisible();
  // The API context has no session cookie: the inbox is not readable without Dana's sign-in.
  const anonymous = await request.get('/api/controller/inbox');
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.json()).toEqual({ error: 'SESSION_REQUIRED' });

  let seq = 0;
  async function tool(name: string, extra: Record<string, unknown>) {
    const res = await request.post(`/api/tools/${name}`, { headers: { authorization: 'Bearer local-tool-test-only' },
      data: { call_id: 'approval-demo', webhook_request_id: `controller-${++seq}`, ...extra } });
    expect(res.ok()).toBe(true);
    return res.json();
  }
  const proposed = await tool('propose_plan', { installments: 4, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
  expect(proposed.kind).toBe('ESCALATE');
  const id = proposed.escalation_id as string;
  // No navigation: the card arrives on the page Dana already has open.
  await expect(page.getByRole('heading', { name: 'Approval needed' })).toBeVisible({ timeout: 5000 });
  expect(new URL(page.url()).pathname).toBe('/controller');
  await expect(page.getByText('$4,950.00', { exact: true })).toBeVisible();
  expect((await alerts(page)).vibrations).toBe(1);
  await page.screenshot({ path: 'test-results/controller-inbox-mobile.png', fullPage: true });

  // A decision without a passkey assertion is rejected and the request stays open.
  for (const data of [{ challengeId: 'fake', response: { method: 'passkey', verified: true } }, { challengeId: 'fake', response: {} }]) {
    const forged = await request.post(`/api/approvals/${id}/decide`, { headers: { origin: 'http://localhost:3036' }, data });
    expect(forged.status()).toBe(403);
  }
  expect((await tool('check_approval', { escalation_id: id })).approval_status).toBe('pending');
  await expect(page.getByRole('button', { name: 'Approve with passkey' })).toBeEnabled();

  const sent = page.waitForRequest(r => r.url().endsWith(`/api/approvals/${id}/decide`) && r.method() === 'POST');
  await page.getByRole('button', { name: 'Approve with passkey' }).click();
  expect(await (await (await sent).response())?.json()).toMatchObject({ escalation: { method: 'passkey', status: 'approved' } });
  await expect(page.getByRole('heading', { name: 'Your decision is recorded.' })).toBeVisible();
  const checked = await tool('check_approval', { escalation_id: id });
  expect(checked).toMatchObject({ approval_status: 'approved', can_confirm: false, decision: { kind: 'Approve' } });
  await page.getByRole('button', { name: 'Back to inbox' }).click();
  await expect(page.getByRole('heading', { name: 'All clear.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await cdp.detach();
});
