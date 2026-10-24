/** Local headless visual verification. No sponsor APIs, credentials or external writes. */
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.OFFICE_URL ?? 'http://localhost:3244';
const out = resolve(process.cwd(), '../docs/evidence/office');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
const writes = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() === 'POST' && !request.url().includes('__next')) writes.push(request.url()); });
await page.route('**/api/demo-status', route => route.fulfill({ json: { measuredAt: new Date().toISOString(), llmEnabled: false, gx10: null } }));
await page.goto(`${base}/office`);
await expect(page.getByText('Preview · simulated state')).toBeVisible();
await expect(page.locator('canvas')).toBeVisible();
await page.waitForTimeout(1800);
const capture = name => page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
await capture('full-floor');
for (const [room, slug] of [['Lobby', 'lobby'], ['Collections', 'collections'], ['Payables', 'payables'], ['Vendor Desk', 'vendor-desk'], ['Dana’s desk', 'dana'], ['Treasury · Locked', 'treasury']]) {
  await page.getByRole('navigation', { name: 'Room camera presets' }).getByRole('button', { name: room, exact: true }).click();
  await page.waitForTimeout(1100);
  await capture(slug);
}
await page.getByRole('button', { name: 'Full floor', exact: true }).click();
await page.getByRole('button', { name: 'Collections badge limits', exact: true }).click();
await expect(page.getByRole('region', { name: 'Collections details' })).toContainText('maxInstallments');
await expect(page.getByRole('region', { name: 'Collections details' })).toContainText('feesWaivablefalse');
await capture('badge-limits');
await page.getByRole('button', { name: 'Close room details' }).click();
await page.getByRole('button', { name: 'Full floor', exact: true }).click();
const started = Date.now();
await page.getByRole('button', { name: 'Preview escalation', exact: true }).click();
await expect(page.locator('[data-agent-id="collections-clerk"]')).toHaveAttribute('data-target', 'dana');
const rowToViewMs = Date.now() - started;
if (rowToViewMs > 1000) throw new Error(`Preview target update took ${rowToViewMs}ms`);
await page.waitForTimeout(1400);
await expect(page.getByText('▱ Folder → Dana’s desk')).toBeVisible();
await capture('escalation-walk');
await page.getByRole('navigation').getByRole('button', { name: 'Treasury · Locked', exact: true }).click();
await page.waitForTimeout(1100);
await page.getByRole('button', { name: 'Preview Treasury denial' }).click();
await expect(page.getByRole('region', { name: 'Office audit receipts' })).toContainText('DENY');
await capture('denied-entry');
const receipts = await page.getByRole('region', { name: 'Office audit receipts' }).textContent();
await page.getByLabel('Office view').selectOption('plan');
await expect(page.getByLabel('2D office floor plan')).toBeVisible();
await expect(page.getByRole('region', { name: 'Office audit receipts' })).toHaveText(receipts);
await capture('floor-plan');
await page.getByLabel('Office view').selectOption('tween');
await page.getByRole('button', { name: 'Full floor', exact: true }).click();
// Measure browser animation cadence, not a hardware-specific GPU guarantee.
const frames = await page.evaluate(() => new Promise(resolve => {
  const deltas = []; let previous = performance.now();
  function sample(now) { deltas.push(now - previous); previous = now; if (deltas.length < 120) requestAnimationFrame(sample); else resolve(deltas.slice(1)); }
  requestAnimationFrame(sample);
}));
const sorted = [...frames].sort((a, b) => a - b);
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
mobile.on('pageerror', error => errors.push(error.message));
await mobile.route('**/api/demo-status', route => route.fulfill({ json: { measuredAt: new Date().toISOString(), llmEnabled: false, gx10: null } }));
await mobile.goto(`${base}/office`);
await expect(mobile.getByLabel('Office view')).toHaveValue('tween');
await mobile.waitForTimeout(1500);
if (await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error('Phone horizontal overflow');
await mobile.screenshot({ path: `${out}/phone-fixed-camera.png`, fullPage: true });
await mobile.getByLabel('Office view').selectOption('plan');
await mobile.screenshot({ path: `${out}/phone-floor-plan.png`, fullPage: true });
if (writes.length) throw new Error(`Renderer issued writes: ${writes.join(', ')}`);
if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
const renderer = await page.evaluate(() => { const gl = document.querySelector('canvas')?.getContext('webgl2'); const info = gl?.getExtension('WEBGL_debug_renderer_info'); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable'; });
const result = { url: base, renderer, rowToViewMs, medianFrameMs: sorted[Math.floor(sorted.length / 2)], p95FrameMs: sorted[Math.floor(sorted.length * 0.95)], browserErrors: errors, rendererWrites: writes, parity: 'View changes preserved the exact audit receipts', note: 'Preview fixture rows; no live SpacetimeDB or business-effect parity claim. Headless Chromium cadence is not a laptop GPU benchmark.' };
await writeFile(`${out}/verification.json`, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
