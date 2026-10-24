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
    const bounds = await panel.boundingBox();
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(out, `office-${name}.png`) });
    await page.getByRole('link', { name: 'Details' }).click();
    await page.getByRole('heading', { level: 1, name: 'Real vs. simulated' }).waitFor();
    assert.equal(await page.getByRole('complementary').count(), 1);
    assert.equal(await page.locator('li').count(), 10);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: resolve(out, `details-${name}.png`), fullPage: true });
    await page.route('**/api/demo-status', route => route.fulfill({ json: {
      measuredAt: new Date().toISOString(), llmEnabled: false, gx10: null,
    } }));
    await page.reload();
    await page.getByText('LLM OFF · model work paused', { exact: false }).waitFor();
    assert.equal(await page.getByText('LLM OFF', { exact: true }).count(), 3);
    await page.screenshot({ path: resolve(out, `off-${name}.png`), fullPage: true });
    await page.unroute('**/api/demo-status');
    await page.route('**/api/demo-status', route => route.fulfill({ status: 503 }));
    await page.reload();
    await page.getByText('Live status unavailable', { exact: false }).waitFor();
    assert.equal(await page.getByText('Unverified', { exact: true }).count(), 6);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS: desktop/mobile overlay, details, OFF and unavailable states; no overflow or page errors.');
} finally { await browser.close(); }
