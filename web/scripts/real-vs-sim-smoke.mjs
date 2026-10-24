import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const base = process.env.DEMO_URL ?? 'http://127.0.0.1:3125';
const out = resolve(process.cwd(), '../docs/evidence/25');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}),
});
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    const panel = page.getByRole('complementary', { name: 'Real versus simulated disclosure' });
    await panel.waitFor();
    await page.getByText('LLM enabled', { exact: false }).waitFor();
    await page.locator('canvas').waitFor();
    // Let the headless GPU paint the office before capturing the disclosure overlay.
    await page.waitForTimeout(800);
    assert.equal(await panel.locator('li').count(), 10);
    // At <=760px the panel body starts collapsed; elsewhere it starts expanded. Either way the toggle round-trips.
    const toggle = panel.getByRole('button', { name: /real versus simulated status/ });
    const body = page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`);
    const assertExpanded = async expanded => {
      assert.equal(await toggle.getAttribute('aria-expanded'), String(expanded));
      assert.equal(await body.isVisible(), expanded);
      assert.equal(await panel.locator('li').filter({ visible: true }).count(), expanded ? 10 : 0);
    };
    const startsExpanded = name !== 'mobile';
    await assertExpanded(startsExpanded);
    await toggle.click();
    await assertExpanded(!startsExpanded);
    await toggle.click();
    await assertExpanded(startsExpanded);
    if (!startsExpanded) await toggle.click();
    await assertExpanded(true);
    // Narrow office layouts dock the panel below the office, so bring it into view before measuring.
    await panel.scrollIntoViewIfNeeded();
    const bounds = await panel.boundingBox();
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(out, `office-${name}.png`) });
    await page.getByRole('link', { name: 'Details' }).click();
    await page.getByRole('heading', { level: 1, name: 'Real vs. simulated' }).waitFor();
    assert.equal(await page.getByRole('complementary').count(), 1);
    assert.equal(await page.getByRole('button', { name: /real versus simulated status/ }).count(), 0);
    assert.equal(await page.locator('li').filter({ visible: true }).count(), 10);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(out, `details-${name}.png`), fullPage: true });
    await page.route('**/api/demo-status', route => route.fulfill({ json: {
      measuredAt: new Date().toISOString(), llmEnabled: false, gx10: null,
    } }));
    await page.reload();
    await page.getByText('LLM OFF · model work paused', { exact: false }).waitFor();
    assert.equal(await page.getByText('LLM OFF', { exact: true }).filter({ visible: true }).count(), 3);
    // Without probe results the other three real services claim nothing.
    assert.equal(await page.getByText('Unverified', { exact: true }).filter({ visible: true }).count(), 3);
    assert.equal(await page.getByText('Not probed in this process', { exact: true }).filter({ visible: true }).count(), 0);
    await page.screenshot({ path: resolve(out, `off-${name}.png`), fullPage: true });
    await page.unroute('**/api/demo-status');
    await page.route('**/api/demo-status', route => route.fulfill({ status: 503 }));
    await page.reload();
    await page.getByText('Live status unavailable', { exact: false }).waitFor();
    // Without a status every real service is Unverified; none is claimed online or unprobed.
    assert.equal(await page.getByText('Unverified', { exact: true }).filter({ visible: true }).count(), 6);
    assert.equal(await page.getByText('Not probed in this process', { exact: true }).filter({ visible: true }).count(), 0);
    // Document routes retain enough scroll space for their controls above the fixed panel.
    await page.unroute('**/api/demo-status');
    await page.goto(`${base}/controller`);
    const setupButton = page.getByRole('button', { name: 'Create Dana’s passkey' });
    await setupButton.waitFor();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const controlBounds = await setupButton.boundingBox();
    const disclosureBounds = await page.getByRole('complementary').boundingBox();
    assert(controlBounds.y + controlBounds.height <= disclosureBounds.y);
    await page.goto(`${base}/approve/nonexistent-disclosure-check`);
    await page.getByRole('complementary').waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: desktop/mobile overlay and Hide/Show toggle, details, OFF and unavailable states; no overflow or page errors.');
} finally { await browser.close(); }
