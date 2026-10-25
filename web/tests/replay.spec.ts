import { test, expect, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReplayFrame } from '@backroom/orchestrator';
import { openSheet } from './office-menu';

const out = resolve(process.cwd(), '../docs/evidence/replay');
const frames = readFileSync(resolve(process.cwd(), '../fixtures/replays/core-offline.jsonl'), 'utf8')
  .trim().split('\n').slice(1, -1).map(line => JSON.parse(line) as ReplayFrame);
async function seek(page: Page, ms: number) {
  await page.getByRole('slider', { name: 'Replay position' }).evaluate((element, value) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, ms);
  await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveValue(String(ms));
}

/** True when two visible boxes share any pixel (including edges that sit on each other). */
async function boxesOverlap(a: Locator, b: Locator) {
  const A = await a.boundingBox();
  const B = await b.boundingBox();
  expect(A, 'missing first box').toBeTruthy();
  expect(B, 'missing second box').toBeTruthy();
  if (!A || !B) return false;
  return !(A.x + A.width <= B.x || B.x + B.width <= A.x || A.y + A.height <= B.y || B.y + B.height <= A.y);
}

test('plays and scrubs the original state/audit into 3D, floor plan and audit wall without network effects', async ({ page }) => {
  await mkdir(out, { recursive: true });
  const errors: string[] = [], api: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(request.url()); });
  await page.goto('/office?replay=core-offline');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByLabel('Replay disclosure')).toContainText('REPLAY');
  await expect(page.locator('canvas')).toBeVisible();
  const escalation = frames.find(frame => frame.phase === 'collections-1042' && frame.operation === 'createCallEscalation')!;
  await seek(page, escalation.atMs + 100);
  await expect(page.locator('[data-agent-id="collections-demo"]')).toHaveAttribute('data-target', 'dana');
  await expect(page.getByText('▱ Folder → Dana’s desk')).toBeVisible();
  const position = await page.getByRole('slider', { name: 'Replay position' }).inputValue();
  await page.waitForTimeout(400);
  await expect(page.getByRole('slider', { name: 'Replay position' })).toHaveValue(position);
  await page.screenshot({ path: `${out}/office-mid-replay.png`, fullPage: true });
  await page.getByLabel('Office view').selectOption('plan');
  await expect(page.getByLabel('2D office floor plan')).toBeVisible();
  await page.screenshot({ path: `${out}/floor-plan-paused.png`, fullPage: true });
  await seek(page, 0);
  await expect(page.getByText(/^No decisions in this run yet/)).toBeVisible();
  await page.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(Number(await page.getByRole('slider', { name: 'Replay position' }).inputValue())).toBeGreaterThan(300);
  await page.getByRole('link', { name: 'Full audit wall', exact: true }).click();
  await expect(page).toHaveURL(/\/audit\?replay=core-offline/);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const duplicate = frames.find(frame => frame.audit.some(entry => entry.ruleIds.includes('DUPLICATE_INVOICE')))!;
  await seek(page, duplicate.atMs + 1);
  await expect(page.getByText(/Recorded chain verified/)).toBeVisible();
  await expect(page.getByRole('button').filter({ hasText: 'DUPLICATE_INVOICE' })).toContainText('NF-021');
  await expect(page.getByRole('heading', { name: 'Ask why', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Operator code')).toHaveCount(0);
  await page.screenshot({ path: `${out}/audit-mid-replay.png`, fullPage: true });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByLabel('Replay disclosure')).toBeInViewport();
  expect(api).toEqual([]);
  expect(errors).toEqual([]);
});

test('phone and invalid recordings keep an explicit replay label', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/office?replay=core-offline');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await seek(page, 4000);
  await page.getByLabel('Office view').selectOption('plan');
  await expect(page.getByLabel('Replay disclosure')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: `${out}/phone-replay.png`, fullPage: true });
  await page.goto('/office?replay=missing');
  await expect(page.getByRole('alert').filter({ hasText: 'could not be verified' })).toBeVisible();
  await expect(page.getByLabel('Replay disclosure')).toContainText('REPLAY');
  await expect(page.locator('canvas')).toHaveCount(0);
});

test('Help Getting Around links into the offline recording', async ({ page }) => {
  await page.goto('/office');
  const help = await openSheet(page, 'help');
  await help.getByRole('link', { name: 'Watch a recorded session', exact: true }).click();
  await expect(page).toHaveURL(/\/office\?replay=core-offline/);
  await expect(page.getByLabel('Replay controls')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`replay banner stays clear of shell chrome at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto('/office?replay=core-offline');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const banner = page.getByLabel('Replay controls');
    const sidebar = page.getByRole('complementary', { name: 'Office navigation' });
    const topbar = page.getByTestId('office-topbar');
    await expect(banner).toBeVisible();
    await expect(sidebar).toBeVisible();
    await expect(topbar).toBeVisible();
    expect(await boxesOverlap(banner, sidebar), 'banner vs sidebar').toBe(false);
    expect(await boxesOverlap(banner, topbar), 'banner vs topbar').toBe(false);
    await page.getByRole('button', { name: 'Full Screen', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Exit Full Screen', exact: true })).toBeVisible();
    await expect(banner).toBeVisible();
    const hud = page.getByRole('group', { name: 'Full screen status' });
    await expect(hud).toBeVisible();
    expect(await boxesOverlap(banner, hud), 'banner vs fullscreen HUD').toBe(false);
    await page.screenshot({ path: info.outputPath(`banner-layout-${viewport.width}.png`), fullPage: true });
  });
}
