/** Opt-in headless walkthrough of an already running, worktree-owned demo.
 * Default: mock bank and LLM OFF. --live explicitly exercises the live web host, with no phone dial.
 * Run: node tools/demo/rehearse.mjs
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';

const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium, expect: baseExpect } = require('@playwright/test');
const expect = baseExpect.configure({ timeout: 15000 });
const owner = JSON.parse(readFileSync('.demo/process.json', 'utf8'));
const controls = Object.fromEntries(readFileSync('.demo/private.env', 'utf8').trim().split('\n').map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
}));
if (existsSync('.env.local')) {
  const team = parseEnv(readFileSync('.env.local', 'utf8'));
  for (const key of Object.keys(controls)) if (team[key]) controls[key] = team[key];
}
if (process.env.TOOL_GATEWAY_SECRET || process.env.CONTROLLER_ENROLLMENT_SECRET || process.env.POLICY_DEMO_PIN) {
  throw new Error('Run without exported control overrides; this script reads the owned .demo/private.env.');
}
async function control(action) {
  const response = await fetch(`http://127.0.0.1:${owner.port}/${action}`, {
    method: action === 'status' ? 'GET' : 'POST', headers: { authorization: `Bearer ${owner.token}` },
    signal: AbortSignal.timeout(135000),
  });
  assert(response.ok, `Demo control ${action} failed`); return response.json();
}
const initial = await control('status');
const live = process.argv.includes('--live');
assert.equal(initial.bank, live ? 'nessie_sandbox' : 'mock', 'Host bank must match explicit walkthrough mode');
if (!process.argv.includes('--paylink')) assert.equal(initial.llmEnabled, live, 'Host LLM mode must match walkthrough mode');
const out = resolve(live ? 'docs/evidence/test-v1/live' : 'docs/evidence/test-v1', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const steps = [];
async function shot(name, detail) {
  await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
  steps.push({ name, detail }); console.log(`PASS ${name}`);
}
if (process.argv.includes('--paylink')) {
  try {
    // Synthetic call registration; no Cartesia session or phone dial.
    const callId = randomUUID();
    const auth = { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' };
    const register = { method: 'POST', headers: auth, body: JSON.stringify({ sessionId: callId }) };
    assert.equal((await fetch(`${initial.localUrl}/__demo/voice-call`, { ...register, headers: { 'content-type': 'application/json' } })).status, 401);
    assert.equal((await fetch(`${initial.publicUrl}/__demo/voice-call`, register)).status, 403);
    assert((await fetch(`${initial.localUrl}/__demo/voice-call`, register)).ok);
    const tool = async (name, args = {}) => {
      const response = await fetch(`${initial.localUrl}/api/tools/${name}`, { method: 'POST',
        headers: { authorization: `Bearer ${controls.TOOL_GATEWAY_SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify({ call_id: callId, webhook_request_id: randomUUID(), ...args }) });
      assert(response.ok); return response.json();
    };
    assert.deepEqual((await tool('get_invoice_context')).rule_ids, ['IDENTITY_REQUIRED']);
    await tool('verify_identity_result', { result: 'confirmed' });
    const plan = await tool('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
    assert.equal(plan.kind, 'ALLOW');
    const link = await tool('send_payment_link', { plan_id: plan.plan_id });
    assert.equal(link.amount_cents, 247500);
    await page.goto(`${initial.publicUrl}/payment-link`);
    await expect(page.getByText(link.short_code, { exact: true })).toBeVisible();
    await page.addScriptTag({ path: require.resolve('jsqr/dist/jsQR.js') });
    const decoded = await page.evaluate(async () => {
      const image = document.querySelector('img[alt="Scan to open your authorized payment page"]');
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return window.jsQR(data.data, data.width, data.height)?.data;
    });
    assert.equal(decoded, `${initial.publicUrl}/p/${link.short_code}`);
    await shot('paylink-01-qr', 'Decoded the rendered QR pixels into the public HTTPS short URL');
    await page.goto(decoded);
    await expect(page.getByRole('button', { name: 'Pay $2,475.00', exact: true })).toBeVisible();
    assert(page.url().endsWith(link.link_path));
    await page.getByRole('button', { name: 'Pay $2,475.00', exact: true }).click();
    await expect(page.getByText('Payment matched. Invoice partially paid.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Deposit recorded', exact: true })).toBeDisabled();
    await expect(page.getByText('Payment matched. Invoice partially paid.')).toBeVisible();
    await shot('paylink-02-reconciled', live ? 'Real Nessie sandbox deposit and exact reducer reconciliation; receipt survives reload' : 'Mock Nessie HTTP and exact reducer reconciliation; receipt survives reload');
    assert.deepEqual(errors, []);
    writeFileSync(resolve(out, 'paylink.json'), JSON.stringify({ at: new Date().toISOString(), bank: initial.bank, phoneDialed: false,
      qrDecoded: true, amountCents: 247500, status: 'partially_paid', privateRegistration: true, steps }, null, 2));
    console.log(`PASS paylink: ${initial.bank}; QR -> short URL -> authorized pay -> deposit -> reconciliation`);
  } finally { await browser.close(); }
  process.exit(0);
}
try {
  let whyResult;
  let modelEvidence = [];
  if (!process.argv.includes('--office-only')) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto(`${initial.publicUrl}/controller`);
    await page.getByLabel('Controller enrollment code').fill(controls.CONTROLLER_ENROLLMENT_SECRET);
    await page.getByRole('button', { name: 'Create Dana’s passkey' }).click();
    await expect(page.getByRole('heading', { name: 'Dana’s passkey is ready.' })).toBeVisible();
    await shot('01-controller', 'Real verifier, Chromium software authenticator; no human biometrics');
    const state = await control('reset'); // Fresh live-call escalation; enrollment survives reset.
    await page.goto(`${state.publicUrl}${state.approvePath}`);
    await expect(page.getByText('MAX_INSTALLMENTS', { exact: true })).toBeVisible();
    await shot('02-four-payments', 'Four-payment escalation with immutable policy evidence');
    await page.getByRole('button', { name: 'Deny with passkey' }).click();
    await expect(page.getByRole('heading', { name: 'Your decision is recorded.' })).toBeVisible();
    await shot('03-denied', `Passkey denial recorded while LLM ${live ? 'ON' : 'OFF'}`);
    // Reset seeds no payment link; send one on the synthetic preverified call through the real gateway.
    const gatewayTool = async (name, args) => {
      const response = await context.request.post(`${state.publicUrl}/api/tools/${name}`, {
        headers: { authorization: `Bearer ${controls.TOOL_GATEWAY_SECRET}` },
        data: { call_id: 'demo-collections-1042', webhook_request_id: `rehearsal-${randomUUID()}`, ...args },
      });
      assert(response.ok(), `Gateway ${name} failed`); return response.json();
    };
    const plan = await gatewayTool('propose_plan', { installments: 2, first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 });
    assert.equal(plan.kind, 'ALLOW');
    const sent = await gatewayTool('send_payment_link', { plan_id: plan.plan_id });
    await page.goto(`${state.publicUrl}${sent.link_path}`);
    await page.getByRole('button', { name: 'Pay $2,475.00', exact: true }).click();
    await expect(page.getByText('Payment matched. Invoice partially paid.')).toBeVisible();
    await shot('04-pay', live ? 'Real Nessie sandbox deposit/reuse and exact reconciliation; display is not settlement' : 'Exact reconciliation; this web host uses mock Nessie HTTP transport');
    for (const preset of ['4419', '4471']) {
      await page.goto(`${state.publicUrl}/inbox`);
      await page.getByLabel('Start with a planted scenario').selectOption(preset);
      await page.getByRole('button', { name: 'Route scenario' }).click();
      const receipt = page.getByRole('region', { name: 'Decision receipt' });
      await expect(receipt.getByText('ESCALATE', { exact: true })).toBeVisible();
      await shot(`05-inbox-${preset}`, `Frozen typed trap held by code with LLM ${live ? 'ON' : 'OFF'}`);
      if (preset === '4471') {
        await expect(receipt).toContainText('LOOKALIKE_DOMAIN');
        await expect(receipt).toContainText('BANK_CHANGE_HOLD');
        const link = await receipt.getByRole('link', { name: /View audit entry/ }).getAttribute('href');
        await page.goto(new URL(link, state.publicUrl).href);
      }
    }
    await page.getByLabel('Operator code').fill(controls.CONTROLLER_ENROLLMENT_SECRET);
    await page.getByRole('button', { name: 'Open audit wall' }).click();
    await expect(page.getByText(/^Chain verified · \d+ entries$/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Replay / })).toBeVisible();
    await shot('06-audit-link', 'Inbox link opens its exact audit entry; full chain verifies');
    await page.getByLabel('Question about a decision').fill('Why was invoice 1042 escalated?');
    const whyResponse = live ? page.waitForResponse(response => new URL(response.url()).pathname === '/api/audit/why') : undefined;
    await page.getByRole('button', { name: 'Explain decision' }).click();
    if (live) {
      const response = await whyResponse; whyResult = await response.json();
      assert.equal(whyResult.source, 'model', 'Live host must return a cited model answer');
    }
    await expect(page.getByText(live ? 'Model explanation · verified citations' : 'Recorded facts · code fallback', { exact: true })).toBeVisible();
    await expect(page.locator('.audit-citations a').first()).toBeVisible();
    await shot(live ? '07-ask-why-live' : '07-ask-why-off', live ? 'Web host Anthropic model answer with verified citations' : 'Cited deterministic answer; no model call');
    const llm = await context.request.get(`${state.publicUrl}/api/llm`, { headers: { authorization: `Bearer ${controls.TOOL_GATEWAY_SECRET}` } });
    assert.deepEqual(await llm.json(), { llmEnabled: live });
    await page.goto(`${state.publicUrl}/real-vs-sim`);
    await expect(page.getByRole('heading', { name: 'Real vs. simulated', exact: true })).toBeVisible();
    await shot('08-real-vs-sim', 'Process observations, not a claim that separate live probes ran here');
    await page.goto(`${state.publicUrl}/policy`);
    await page.getByLabel('Owner demo PIN').fill(controls.POLICY_DEMO_PIN);
    await page.getByRole('button', { name: 'Unlock policy' }).click();
    await page.getByLabel('Maximum installments', { exact: true }).fill('3');
    await page.getByRole('button', { name: 'Save as v2' }).click();
    await expect(page.getByRole('status')).toContainText('Saved v2.');
    const offer = await context.request.post(`${state.publicUrl}/api/tools/propose_plan`, {
      headers: { authorization: `Bearer ${controls.TOOL_GATEWAY_SECRET}` },
      data: { call_id: 'demo-collections-1042', webhook_request_id: `rehearsal-${Date.now()}`, installments: 3,
        first_payment_pct: 50, duration_days: 30, waive_fee: false, discount_pct: 0 },
    });
    assert.equal((await offer.json()).kind, 'ALLOW');
    await shot('09-policy-v2', 'Saved max 3; subsequent three-payment gateway request ALLOW');
    await page.getByRole('button', { name: 'Lock editor' }).click();
    if (live) {
      await page.goto(`${state.publicUrl}/inbox`);
      await page.getByLabel('Start with a planted scenario').selectOption('4419');
      const text = await page.getByLabel('Email, invoice, or your own scenario').inputValue();
      const senderDomain = await page.getByLabel('Sender domain').inputValue();
      // Same invoice through free-form extraction: deliberately omit presetId.
      const response = await context.request.post(`${state.publicUrl}/api/inbox`, {
        headers: { origin: state.publicUrl }, multipart: { text, kind: 'invoice', senderDomain },
      });
      assert(response.ok(), 'Live free-form inbox response');
      const intake = await response.json();
      assert.equal(intake.decision.kind, 'ESCALATE', 'Free-form trap remains held');
      const snapshot = await context.request.get(`${state.publicUrl}/api/audit/entries`);
      const { entries, chain } = await snapshot.json();
      assert(chain.valid, 'Model extraction audit chain');
      modelEvidence = entries.filter(row => row.refs.includes(intake.id) && ['inbox_classified', 'fields_extracted'].includes(row.action))
        .map(({ action, route, costUsd, latencyMs, inputs }) => ({ action, route, costUsd, latencyMs, model: inputs?.model }));
      assert(modelEvidence.some(row => row.action === 'inbox_classified' && row.route === 'local'), 'Routine classification must actually use GX10');
      assert(modelEvidence.some(row => row.action === 'fields_extracted' && ['local', 'cloud_fallback'].includes(row.route)), 'Extraction must use the shared local-first router');
      steps.push({ name: 'live-freeform-inbox', detail: 'GX10 classification + local-first routed field extraction, code holds the trap', modelEvidence });
    }
  }
  const state = await control('status');
  await page.goto(`${state.localUrl}/office`);
  await expect(page.getByText('State connected', { exact: true })).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  await shot('10-office-orbit', 'Local loopback Spacetime subscription connected');
  await page.getByLabel('Office view').selectOption('tween');
  await page.waitForTimeout(1500);
  await shot('11-office-fixed', 'Fixed camera fallback');
  for (const room of ['Lobby', 'Collections', 'Payables', 'Vendor Desk', 'Dana’s desk', 'Treasury · Locked']) {
    const button = page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: room, exact: true });
    await button.click();
    await page.waitForTimeout(1600);
    await shot(`11-room-${room.split(' ')[0].toLowerCase().replace('’', '')}`, `Manual camera preset: ${room}`);
  }
  await page.getByLabel('Office view').selectOption('plan');
  await expect(page.getByLabel('2D office floor plan')).toBeVisible();
  await shot('12-office-plan', 'Same subscribed state in 2D');
  const tour = await page.getByLabel('Office view').locator('option').allTextContents();
  steps.push({ name: 'office-tour', detail: `Available modes: ${tour.join(', ')}` });
  assert.deepEqual(errors, [], 'Browser runtime errors');
  writeFileSync(resolve(out, 'receipt.json'), JSON.stringify({ measuredAt: new Date().toISOString(), steps,
    errors, state: state.stateStore, bank: state.bank, llm: live ? 'ON' : 'OFF', services: state.services,
    ...(live ? { whyResult, modelEvidence } : {}),
    passkey: process.argv.includes('--office-only') ? 'not exercised' : 'software test authenticator', phone: 'not dialed' }, null, 2) + '\n');
  console.log(`Screenshots and receipt: ${out}`);
} catch (error) {
  let detail = error instanceof Error ? error.stack ?? error.message : 'Unknown failure';
  for (const value of Object.values(controls)) if (value) detail = detail.split(value).join('<redacted>');
  writeFileSync('.demo/rehearsal-error.txt', detail, { mode: 0o600 });
  // Playwright errors can serialize password fields in their DOM snapshot.
  console.error(`Rehearsal failed after ${steps.at(-1)?.name ?? 'startup'}; inspect locally without sharing credentials.`);
  process.exitCode = 1;
} finally { await browser.close(); }
