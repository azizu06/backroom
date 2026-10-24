import { test, expect, type Page } from '@playwright/test';

type Alerts = { chimes: number; audible: number; vibrations: number; locks: number; released: number };
// Counts chimes, vibrations and screen wake locks without changing what the page does.
// Headless Chromium autoplays audio, so the iOS rule is modelled here: a context plays only if
// it was created or resumed during a user tap. `audible` counts chimes that rule lets through.
// Counters arrive as console events: page.evaluate and locator checks would themselves count as a tap.
async function spyAlerts(page: Page) {
  let latest: Alerts = { chimes: 0, audible: 0, vibrations: 0, locks: 0, released: 0 };
  page.on('console', message => { if (message.text().startsWith('alerts ')) latest = JSON.parse(message.text().slice(7)); });
  await page.addInitScript(() => {
    const w = { chimes: 0, audible: 0, vibrations: 0, locks: 0, released: 0 };
    const report = () => console.debug(`alerts ${JSON.stringify(w)}`);
    const Real = window.AudioContext;
    class GestureAudioContext extends Real {
      unlocked = navigator.userActivation.isActive;
      override resume() {
        if (navigator.userActivation.isActive) this.unlocked = true;
        return this.unlocked ? super.resume() : Promise.resolve();
      }
    }
    window.AudioContext = GestureAudioContext;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      w.chimes++; if ((this.context as GestureAudioContext).unlocked) w.audible++;
      report();
      return start.apply(this, args);
    };
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => { w.vibrations++; report(); return true; } });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      w.locks++; report();
      const sentinel = { released: false, release: async () => { if (!sentinel.released) { sentinel.released = true; w.released++; report(); } } };
      return sentinel;
    } } });
  });
  return () => latest;
}

test('a stubbed escalation rings and opens on /controller without anyone sharing a link', async ({ page }) => {
  const alerts = await spyAlerts(page);
  const now = Date.now();
  const escalation = { id: 'stub-escalation-1', taskId: 'call:stub', callId: 'stub', fromAgent: 'collections-1', toHuman: 'Dana',
    ruleIds: ['MAX_INSTALLMENTS'], evidenceRefs: ['audit:stub', '1042'], status: 'pending', createdAt: now, expiresAt: now + 60_000,
    policyVersion: 1, quote: { sentenceId: 'NF-005', text: 'At most two installments; ask Dana for an exception.' },
    invoiceId: '1042', amountCents: 495000, principalCents: 480000, lateFeeCents: 15000, currency: 'USD',
    requestedTerms: { installments: 4, firstPaymentPct: 50, durationDays: 30, waiveFee: false, discountPct: 0 } };
  let polls = 0;
  let expired = false;
  await page.route('**/api/controller/view', route => route.fulfill({ json: { registered: true, signedIn: !expired } }));
  await page.route('**/api/controller/inbox', route => expired
    ? route.fulfill({ status: 401, json: { error: 'SESSION_REQUIRED' } })
    : route.fulfill({ json: { escalations: ++polls < 3 ? [] : [escalation] } }));
  await page.route(`**/api/approvals/${escalation.id}/view`, route => route.fulfill({ json: { escalation, registered: true } }));
  // No page interaction until the request rings: this models a reload that is signed in but has had no tap.
  const rung = page.waitForEvent('console', { timeout: 8000,
    predicate: message => message.text().startsWith('alerts ') && JSON.parse(message.text().slice(7)).vibrations === 1 });
  await page.goto('/controller');
  await rung;
  expect(polls).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('heading', { name: 'Approval needed' })).toBeVisible();
  await expect(page.getByText('$4,950.00', { exact: true })).toBeVisible();
  await expect(page.getByText('MAX_INSTALLMENTS', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve with passkey' })).toBeEnabled();
  expect(new URL(page.url()).pathname).toBe('/controller');
  await expect(page).toHaveTitle('(1) Approval needed · Backroom');
  const rang = alerts();
  // The chime ran but could not be heard without a tap, so the page offers one instead of pretending sound works.
  expect(rang).toMatchObject({ audible: 0, vibrations: 1, locks: 1, released: 0 });
  expect(rang.chimes).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Tap to turn on the request chime' })).toBeVisible();
  // Later polls of the same request do not ring again.
  await page.waitForTimeout(3200);
  expect(alerts()).toEqual(rang);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Session expiry returns to sign-in and lets the screen sleep again.
  expired = true;
  await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toBeVisible({ timeout: 5000 });
  await expect.poll(alerts).toMatchObject({ locks: 1, released: 1 });
});

test('Dana signs in once; a live escalation appears by itself, a forged decision is rejected, and her passkey decides', async ({ page, request }) => {
  const alerts = await spyAlerts(page);
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
  // The sign-in tap unlocked audio, so this chime played on a running AudioContext.
  await expect.poll(alerts).toMatchObject({ vibrations: 1, audible: 2 });
  await expect(page.getByRole('button', { name: 'Tap to turn on the request chime' })).toHaveCount(0);
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
