/** Explicit opt-in: disposable local SpacetimeDB + production Next + headless Chromium. No sponsor calls. */
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, expect, type Browser, type Page } from '@playwright/test';
import { DbConnection } from '../../orchestrator/src/spacetime-client';
import { SpacetimeStateStore } from '../../orchestrator/src/spacetime-store';
import { runInboxTrap } from '../../orchestrator/src/core-demo/core';
import { canonicalAuditJson } from '../../orchestrator/src/audit';
import type { AuditEntry } from '../../orchestrator/src/store';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = resolve(root, 'docs/evidence/parity');
const scratch = resolve(root, `.t8-tools/office-parity-${Date.now()}`);
const cli = process.env.SPACETIME_CLI ?? resolve(root, '.t8-tools/spacetime/spacetime');
const cliRoot = process.env.SPACETIME_ROOT ?? resolve(root, '.t8-tools/spacetime');
const normalize = (entries: AuditEntry[]) => entries.map(({ ts, hash, prevHash, ...body }) => body);
async function port() {
  return new Promise<number>(done => { const server = createServer(); server.listen(0, '127.0.0.1', () => {
    const address = server.address(); assert(address && typeof address !== 'string'); server.close(() => done(address.port));
  }); });
}
async function until(check: () => Promise<boolean>, label: string) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
async function stop(child: ChildProcess | undefined) {
  if (!child || (child.exitCode !== null || child.signalCode !== null)) return;
  child.kill('SIGTERM');
  await new Promise<void>(done => child.once('exit', () => done()));
}
async function main() {
  mkdirSync(scratch, { recursive: true }); mkdirSync(out, { recursive: true });
  const prefix = [`--root-dir=${cliRoot}`, `--config-path=${resolve(scratch, 'cli.toml')}`];
  const dbPort = await port(), webPort = await port();
  const uri = `ws://127.0.0.1:${dbPort}`, http = `http://127.0.0.1:${dbPort}`, base = `http://localhost:${webPort}`;
  // The lobby audit wall is operator-gated (#82). Parity unlocks it the way a real operator does.
  const operatorCode = randomBytes(24).toString('hex');
  const dbLog = openSync(resolve(scratch, 'server.log'), 'w');
  const server = spawn(cli, [...prefix, 'start', '--listen-addr', `127.0.0.1:${dbPort}`,
    '--data-dir', resolve(scratch, 'db'), '--in-memory', '--non-interactive'], { cwd: root, stdio: ['ignore', dbLog, dbLog] });
  closeSync(dbLog);
  const stores: SpacetimeStateStore[] = [];
  let browser: Browser | undefined, web: ChildProcess | undefined, writer: DbConnection | undefined;
  const errors: string[] = [], writes: string[] = [];
  try {
    await until(async () => { try { return (await fetch(`${http}/v1/ping`)).ok; } catch { return false; } }, 'owned local server');
    const names = ['closed', 'open'].map(mode => `backroom-office-${Date.now()}-${mode}`);
    for (const database of names) execFileSync(cli, [...prefix, 'publish', database!, '--server', http, '--module-path', 'spacetime', '--yes'],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    const token = /^spacetimedb_token\s*=\s*"([^"]+)"/m.exec(readFileSync(resolve(scratch, 'cli.toml'), 'utf8'))?.[1];
    assert(token, 'isolated publisher identity missing');
    const store = (database: string) => { const result = new SpacetimeStateStore({ uri, database, token }); stores.push(result); return result; };
    const startWeb = async (database: string) => {
      const log = openSync(resolve(scratch, `${database}.web.log`), 'w');
      web = spawn(process.execPath, [resolve(root, 'web/node_modules/next/dist/bin/next'), 'start', '--port', String(webPort)], {
        cwd: resolve(root, 'web'), stdio: ['ignore', log, log], env: { ...process.env,
          STATE_STORE: 'spacetime', SPACETIMEDB_URI: uri, SPACETIMEDB_DATABASE: database, SPACETIMEDB_TOKEN: token,
          CONTROLLER_ENROLLMENT_SECRET: operatorCode, WEBAUTHN_ORIGIN: base, WEBAUTHN_RP_ID: 'localhost',
          GX10_ENABLED: 'false', OPENROUTER_API_KEY: '', BACKROOM_APPROVAL_DEMO: '', BACKROOM_PAYMENT_DEMO: '', BACKROOM_DEMO: '' },
      });
      closeSync(log);
      await until(async () => { try { return (await fetch(`${base}/office`)).ok; } catch { return false; } }, 'production office');
    };
    const open = async () => {
      const page = await browser!.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { const path = new URL(request.url()).pathname;
        // The read-only audit session cookie is the operator unlock, not a state write.
        if (request.method() !== 'GET' && !request.url().includes('__next') && path !== '/api/audit/session') writes.push(`${request.method()} ${path}`); });
      await page.goto(`${base}/office`);
      await expect(page.locator('[data-connection="live"]')).toBeVisible();
      await expect(page.locator('canvas')).toBeVisible();
      const lobby = page.locator('#office-audit-wall');
      await lobby.getByLabel('Operator code').fill(operatorCode);
      await lobby.getByRole('button', { name: 'Open audit wall' }).click();
      await expect(lobby.getByText(/^Chain verified · \d+ entries$/)).toBeVisible();
      return page;
    };
    const caughtUp = async (page: Page, entries: AuditEntry[]) => {
      await expect(page.locator('[data-agent-id="payables-demo"]')).toHaveAttribute('data-target', 'dana');
      await expect(page.locator('[data-agent-id="payables-demo"]')).toHaveAttribute('data-escalating', 'true');
      for (const entry of entries) await expect(page.locator(`[data-audit-id="${entry.id}"]`)).toBeAttached();
      await expect(page.getByRole('region', { name: 'Lobby inbox tray' })).toContainText('4471');
    };
    // No browser process exists during this scenario.
    const closedStore = store(names[0]!); await closedStore.ready;
    const closed = await runInboxTrap({ store: closedStore });
    assert(closed.chainValid && closed.bankEffects === 0 && closed.modelRequests === 0);
    writeFileSync(resolve(out, 'closed.audit.json'), JSON.stringify(closed.entries, null, 2) + '\n');
    await startWeb(names[0]!);
    browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    let page = await open();
    await caughtUp(page, closed.entries);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(out, 'closed-catchup.png'), fullPage: true });
    await page.close(); await stop(web); web = undefined;

    // An anonymous 3D subscriber is present throughout the identical server scenario.
    const openStore = store(names[1]!); await openStore.ready;
    await startWeb(names[1]!); page = await open();
    const opened = await runInboxTrap({ store: openStore });
    await caughtUp(page, opened.entries);
    assert(opened.chainValid && opened.bankEffects === 0 && opened.modelRequests === 0);
    writeFileSync(resolve(out, 'open.audit.json'), JSON.stringify(opened.entries, null, 2) + '\n');
    const closedBody = canonicalAuditJson(normalize(closed.entries));
    const openBody = canonicalAuditJson(normalize(opened.entries));
    writeFileSync(resolve(out, 'closed.normalized.json'), closedBody + '\n');
    writeFileSync(resolve(out, 'open.normalized.json'), openBody + '\n');
    assert.equal(closedBody, openBody, 'closed/open server audit differs');
    console.log(`PASS: ${closed.entries.length} byte-identical normalized audit rows; both chains verify; closed-world catchup`);

    writer = await new Promise<DbConnection>((done, reject) => {
      const connection = DbConnection.builder().withUri(uri).withDatabaseName(names[1]!).withToken(token)
        .onConnect(() => done(connection)).onConnectError((_ctx, error) => reject(error)).build();
    });
    // Measure the first rendered frame after React commits each fresh target row.
    // Browser and standalone server share this host's wall clock. Never count initial snapshots.
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const target = i % 2 ? 'payables_desk' : 'lobby';
      const expected = i % 2 ? 'payables' : 'lobby';
      await page.evaluate(({ expected }) => {
        const scope = window as typeof window & { officeSample?: Promise<number> };
        scope.officeSample = new Promise<number>((done, reject) => {
        const timer = setTimeout(() => { observer.disconnect(); reject(new Error('Fresh row did not reach the view')); }, 3000);
        const row = document.querySelector<HTMLElement>('[data-agent-id="payables-demo"]')!;
        const observer = new MutationObserver(() => {
          if (row.dataset.target !== expected) return;
          observer.disconnect(); clearTimeout(timer);
          requestAnimationFrame(() => requestAnimationFrame(() => done(Date.now() - Number(row.dataset.rowAt))));
        });
        observer.observe(row, { attributes: true });
        });
      }, { expected });
      await writer.reducers.setAgentTarget({ agentId: 'payables-demo', targetAnchor: target });
      const ms = await page.evaluate(() => (window as typeof window & { officeSample: Promise<number> }).officeSample); samples.push(ms); assert(ms >= 0 && ms <= 1000, `row/frame ${ms}ms exceeds 1s`);
      await delay(125);
    }
    // Real reducer DENY, exact audit receipt, and a visible red door.
    const before = await openStore.getAgent('payables-demo');
    await writer.reducers.requestRoomEntry({ agentId: 'payables-demo', room: 'treasury' });
    assert.deepEqual(await openStore.getAgent('payables-demo'), before);
    const denial = (await openStore.listAudit()).at(-1)!;
    assert.equal(denial.decision, 'DENY'); assert.equal(denial.action, 'request_room_entry');
    await expect(page.locator(`[data-audit-id="${denial.id}"]`)).toContainText('DENY');
    await page.getByLabel('Office view').selectOption('plan');
    await expect(page.locator(`[data-denial-audit="${denial.id}"]`)).toBeVisible();
    await page.screenshot({ path: resolve(out, 'denied-floor-plan.png'), fullPage: true });
    await page.getByLabel('Office view').selectOption('tween');
    // Decode an actual screenshot: WebGL drawing buffers can be cleared before readPixels.
    await page.waitForTimeout(250);
    const canvasPng = await page.locator('canvas').screenshot();
    const redDoorPixels = await page.evaluate(async data => {
      const picture = new Image(); picture.src = `data:image/png;base64,${data}`; await picture.decode();
      const canvas = document.createElement('canvas'); canvas.width = picture.width; canvas.height = picture.height;
      const context = canvas.getContext('2d')!; context.drawImage(picture, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! > 170 && pixels[i]! > pixels[i + 1]! * 1.6 && pixels[i]! > pixels[i + 2]! * 1.6) red++;
      return red;
    }, canvasPng.toString('base64'));
    await page.screenshot({ path: resolve(out, 'denied-3d.png'), fullPage: true });
    assert(redDoorPixels > 20, 'captured 3D denial has no red pixels');
    await openStore.setLlmEnabled(false);
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    assert.equal(writes.length, 0, 'renderer caused a write'); assert.equal(errors.length, 0, errors.join('; '));
    const sorted = [...samples].sort((a, b) => a - b);
    const proof = { measuredAt: new Date().toISOString(), backend: 'SpacetimeDB 2.13.0 local standalone', scenario: 'moment 2 / runInboxTrap',
      auditEntries: closed.entries.length, normalizedAuditByteIdentical: true, excluded: ['ts', 'hash', 'prevHash'], idsPreserved: true,
      chainsValid: true, closedWorldCaughtUp: true, bankEffects: 0, modelRequests: 0,
      rowToFrameMs: samples, minMs: sorted[0], medianMs: sorted[10], p95Ms: sorted[18], maxMs: sorted.at(-1),
      denialAuditId: denial.id, redDoorPixels, denialPreservesAgentRow: true, runtimeOffObserved: true,
      rendererWrites: writes, browserErrors: errors, maincloud: 'not measured',
      note: 'Same-host clock; DOM target commit + two animation frames. Measures animation response, not walk completion or physical display/GPU performance.' };
    writeFileSync(resolve(out, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(`PASS: 20/20 row-to-frame samples <=1s; max ${proof.maxMs}ms; denied door ${denial.id}; no renderer writes`);
    console.log(`Evidence: ${out}`);
  } finally {
    writer?.disconnect(); await browser?.close(); await stop(web);
    await Promise.all(stores.map(store => store.close())); await stop(server);
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message.slice(0, 1000) : 'OFFICE_PARITY_FAILED'); process.exitCode = 1; });
