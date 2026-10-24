/** Opt-in headless walkthrough of an already running, worktree-owned demo.
 * No phone, external model, Actor, or bank requests; demo bank transport is mock.
 * Run: node tools/demo/rehearse.mjs
 */
import assert from 'node:assert/strict';
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
    signal: AbortSignal.timeout(35000),
  });
  assert(response.ok, `Demo control ${action} failed`); return response.json();
}
const initial = await control('status');
assert(initial.bank === 'mock', 'Only the mock-bank rehearsal host is permitted');
assert(initial.llmEnabled === false, 'Start with LLM OFF');
const out = resolve('docs/evidence/test-v1', new Date().toISOString().replaceAll(':', '-'));
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
try {
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
    const state = await control('reset'); // Fresh 60-second escalation; enrollment survives reset.
    await page.goto(`${state.publicUrl}${state.approvePath}`);
    await expect(page.getByText('MAX_INSTALLMENTS', { exact: true })).toBeVisible();
    await shot('02-four-payments', 'Four-payment escalation with immutable policy evidence');
    await page.getByRole('button', { name: 'Deny with passkey' }).click();
    await expect(page.getByRole('heading', { name: 'Your decision is recorded.' })).toBeVisible();
    await shot('03-denied', 'Passkey denial recorded while LLM OFF');
    await page.goto(`${state.publicUrl}${state.payPath}`);
    await page.getByRole('button', { name: 'Pay $2,475.00 with simulated card', exact: true }).click();
    await expect(page.getByText('Payment matched. Invoice partially paid.')).toBeVisible();
    await shot('04-pay', 'Exact reconciliation; this web host uses mock Nessie HTTP transport');
    for (const preset of ['4419', '4471']) {
      await page.goto(`${state.publicUrl}/inbox`);
      await page.getByLabel('Start with a planted scenario').selectOption(preset);
      await page.getByRole('button', { name: 'Route scenario' }).click();
      const receipt = page.getByRole('region', { name: 'Decision receipt' });
      await expect(receipt.getByText('ESCALATE', { exact: true })).toBeVisible();
      await shot(`05-inbox-${preset}`, 'Frozen typed trap held by code with LLM OFF');
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
    await page.getByRole('button', { name: 'Explain decision' }).click();
    await expect(page.getByText('Recorded facts · code fallback', { exact: true })).toBeVisible();
    await expect(page.locator('.audit-citations a').first()).toBeVisible();
    await shot('07-ask-why-off', 'Cited deterministic answer; no model call');
    const llm = await context.request.get(`${state.publicUrl}/api/llm`, { headers: { authorization: `Bearer ${controls.TOOL_GATEWAY_SECRET}` } });
    assert.deepEqual(await llm.json(), { llmEnabled: false });
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
    errors, state: state.stateStore, bank: 'mock', llm: 'OFF',
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
