/** Opt-in, no-model/no-bank host comparison. Mutates only synthetic inbox/audit rows.
 * STATE_STORE=memory pnpm --filter @backroom/orchestrator exec tsx ../tools/demo/measure-hosts.ts \
 *   mac=http://127.0.0.1:3350 gx10=http://100.117.44.20:3340
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { inboxPresets } from '../../web/lib/inbox/presets';
async function main() {
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const preset = inboxPresets.find(row => row.id === '4419')!;
const targets = process.argv.slice(2).map(arg => {
  const at = arg.indexOf('='); const name = arg.slice(0, at), url = new URL(arg.slice(at + 1));
  assert(/^[a-z0-9_-]+$/.test(name) && ['http:', 'https:'].includes(url.protocol));
  assert(!url.username && !url.password && !url.search && url.pathname === '/');
  const decisionOrigin = new URL(process.env[`${name.toUpperCase()}_PUBLIC_URL`] || url.origin).origin;
  return { name, origin: url.origin, decisionOrigin };
});
assert(targets.length >= 2, 'Pass at least two name=http://host targets');
const summary = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samplesMs: values, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] };
};
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const target of targets) {
    const decisions: number[] = [], pages: number[] = [], connected: number[] = [];
    // Warm server compilation/HTTP pools once, excluded from measured samples.
    const warm = await fetch(`${target.origin}/office`); assert(warm.ok); await warm.arrayBuffer();
    for (let i = 0; i < 10; i++) {
      const form = new FormData();
      for (const [key, value] of Object.entries({ presetId: preset.id, kind: preset.kind, senderDomain: preset.senderDomain, text: preset.text })) form.set(key, value);
      const start = performance.now();
      const response = await fetch(`${target.decisionOrigin}/api/inbox`, { method: 'POST', headers: { origin: target.decisionOrigin }, body: form, signal: AbortSignal.timeout(15000) });
      const body = await response.json();
      assert(response.ok, `Intake HTTP ${response.status}`);
      assert(body.decision.kind !== 'ALLOW' && body.decision.ruleIds.includes('DUPLICATE_INVOICE'), 'Duplicate must stay held');
      assert(body.extractionSource === 'seed', 'Benchmark must not invoke a model');
      decisions.push(Math.round(performance.now() - start));
    }
    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(); const errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      const start = performance.now();
      const response = await page.goto(`${target.origin}/office`, { waitUntil: 'load', timeout: 30000 });
      assert(response?.ok()); pages.push(Math.round(performance.now() - start));
      await page.getByText('State connected', { exact: true }).waitFor({ timeout: 15000 });
      connected.push(Math.round(performance.now() - start));
      assert.deepEqual(errors, []);
      await context.close();
    }
    results.push({ name: target.name, origin: target.origin, decisionOrigin: target.decisionOrigin, decision: summary(decisions), pageLoad: summary(pages), stateConnected: summary(connected) });
  }
} finally { await browser.close(); }
const receipt = { at: new Date().toISOString(), scope: 'Mac client; production hosts; fresh Chromium contexts; page over direct host; decision over public tunnel; synthetic duplicate preset; code decision only, no model/bank/dial; server warmed', results };
mkdirSync(`${root}docs/evidence/gx10-host`, { recursive: true });
writeFileSync(`${root}docs/evidence/gx10-host/latency.json`, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));

}
main().catch(error => { console.error(error); process.exitCode = 1; });
