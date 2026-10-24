// Headless UI check against a task-owned running web server; all telemetry is mocked.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const baseURL = process.env.GX10_BROWSER_URL;
if (!baseURL) throw new Error('Set GX10_BROWSER_URL to a task-owned web server');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let online = true;
  await page.route('**/api/gx10', route => route.fulfill({ json: {
    measuredAt: new Date().toISOString(), reachable: online, models: online ? ['test-local-model'] : [], gpuUtilization: null,
    telemetry: online ? { scope: 'process-local, last 200 HTTP attempts', totalCalls: 2, localCalls: 1, localShare: 0.5,
      estimatedSavingsUsd: 0.003, pricedLocalCalls: 1, comparisonModel: 'claude-sonnet-5-5',
      recent: { at: new Date().toISOString(), latencyMs: 1000, tokensPerSecond: 100 } } : null,
  } }));
  await page.goto(new URL('/office', baseURL).href);
  const panel = page.getByTestId('gx10-readout');
  await panel.getByText('100.0 tok/s', { exact: true }).waitFor();
  assert.match(await panel.innerText(), /50%/);
  assert.match(await panel.innerText(), /~\$0\.003000/);
  assert.match(await panel.innerText(), /1\/2 attempts local/);
  const bounds = await panel.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1440);
  await panel.getByText('Measurement details', { exact: true }).click();
  assert.match(await panel.innerText(), /Cloud fallbacks may send task input off-site/);
  online = false;
  await panel.getByText('GX10 · Unreachable', { exact: true }).waitFor();
  assert.doesNotMatch(await panel.innerText(), /100\.0 tok\/s|50%|~\$0\.003000/);
  assert.deepEqual(errors, []);
  console.log('GX10 UI: online metrics, disclosure, offline clearing, viewport bounds, no page errors passed (mocked HTTP).');
} finally { await browser.close(); }
