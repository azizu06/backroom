import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { PHONE_INTERACTION } from '../lib/office/props/phone';

const surface = (page: Page) => page.getByRole('application', { name: /First-person office/ });
async function pos(page: Page) {
  return surface(page).evaluate(el => ({ x: Number((el as HTMLElement).dataset.playerX), z: Number((el as HTMLElement).dataset.playerZ), yaw: Number((el as HTMLElement).dataset.playerYaw) }));
}
async function hold(page: Page, key: string, until: (p: Awaited<ReturnType<typeof pos>>) => boolean) {
  await page.keyboard.down(key);
  try { await expect.poll(async () => until(await pos(page)), { timeout: 15_000 }).toBe(true); } finally { await page.keyboard.up(key); }
}
async function walkX(page: Page, goal: number) {
  for (let i = 0; i < 20; i++) {
    const p = await pos(page); if (Math.abs(p.x - goal) < 0.08) return;
    await hold(page, goal < p.x ? 'a' : 'd', n => goal < p.x ? n.x <= goal + 0.08 : n.x >= goal - 0.08);
  }
}
async function aimAtPhone(page: Page) {
  const phone = PHONE_INTERACTION.position;
  // A quick press can end before the demand-rendered rig consumes it. Hold until a
  // rendered heading reaches the phone's cone rather than requiring sub-frame precision.
  for (let i = 0; i < 16; i++) {
    const p = await pos(page);
    const angle = Math.atan2(-(phone[0] - p.x), -(phone[1] - p.z));
    const diff = Math.atan2(Math.sin(angle - p.yaw), Math.cos(angle - p.yaw));
    if (Math.abs(diff) <= 0.2) return;
    const key = diff > 0 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(({ phone, diff }) => {
        const pose = document.querySelector<HTMLElement>('[data-player-yaw]')?.dataset;
        if (!pose) return false;
        const angle = Math.atan2(-(phone[0] - Number(pose.playerX)), -(phone[1] - Number(pose.playerZ)));
        const raw = angle - Number(pose.playerYaw);
        const remaining = Math.atan2(Math.sin(raw), Math.cos(raw));
        return Math.abs(remaining) <= 0.2 || Math.sign(remaining) !== Math.sign(diff);
      }, { phone, diff }, { polling: 'raf' });
    } finally { await page.keyboard.up(key); }
  }
  throw new Error('Could not face the desk phone');
}
test('collections desk phone plays a mock callback and keeps the preview from requesting calls', async ({ page }) => {
  const shots = process.env.BR_SHOTS === '1';
  if (shots) await mkdir('/tmp/br-3d', { recursive: true });
  const calls: { url: string; type: string }[] = [];
  page.on('request', request => calls.push({ url: request.url(), type: request.resourceType() }));
  if (shots) {
    await page.goto('/office?calls=mock&callsSpeed=slow&view=overview');
    await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/br-3d/phone-overview.png' });
  }
  await page.goto('/office?calls=mock&callsSpeed=fast&view=overview');
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await select.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
  // Pass the collections doorway between its posts, then move to the phone's aisle-side x.
  await page.keyboard.down('w');
  await expect.poll(async () => (await pos(page)).z, { timeout: 15_000 }).toBeLessThan(-3.0);
  await page.keyboard.up('w');
  await walkX(page, -8.2);
  await page.keyboard.down('w');
  await expect.poll(async () => (await pos(page)).z, { timeout: 15_000 }).toBeLessThan(-3.9);
  await page.keyboard.up('w');
  // Face the phone (desk top) from the aisle.
  await aimAtPhone(page);
  await expect(page.getByText('E · Use desk phone')).toBeVisible();
  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'Collections desk phone' });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.getByTestId('phone-status').innerText(), { timeout: 20_000, intervals: [100] }).toContain('Ringing');
  if (shots) await page.screenshot({ path: '/tmp/br-3d/phone-ringing.png' });
  await expect.poll(() => dialog.getByTestId('phone-status').innerText(), { timeout: 10_000, intervals: [100] }).toContain('Live');
  await expect(dialog.getByTestId('phone-transcript').locator('li').first()).toContainText('Collections');
  if (shots) await page.screenshot({ path: '/tmp/br-3d/phone-live.png' });
  await expect(dialog).toContainText('AI-disclosed');
  await expect(dialog.getByTestId('phone-precall')).toContainText('Scripted call: no pre-call evidence');
  await expect.poll(() => dialog.getByTestId('phone-status').innerText(), { timeout: 15_000, intervals: [100] }).toContain('Ended');
  if (shots) await page.screenshot({ path: '/tmp/br-3d/phone-ended.png' });
  await expect(dialog.getByTestId('phone-request')).toHaveAttribute('aria-disabled', 'false');
  await dialog.getByTestId('phone-request').click();
  await expect(dialog.getByTestId('phone-request-result')).toHaveText('Scripted call: no call placed');
  if (shots) await page.screenshot({ path: '/tmp/br-3d/phone-request.png' });
  expect(calls.filter(({ url, type }) => /call/i.test(url) && !['document', 'script', 'stylesheet', 'font', 'image'].includes(type))).toEqual([]);
});

test('phone stays idle without the mock query', async ({ page }) => {
  await page.goto('/office?view=overview');
  const select = page.getByLabel('Office view');
  await select.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeVisible();
  // Target is already within reach at spawn only after approaching the Collections desk.
  await page.keyboard.down('w'); await expect.poll(async () => (await pos(page)).z, { timeout: 15_000 }).toBeLessThan(-3.0); await page.keyboard.up('w');
  await walkX(page, -8.2);
  await page.keyboard.down('w'); await expect.poll(async () => (await pos(page)).z, { timeout: 15_000 }).toBeLessThan(-3.9); await page.keyboard.up('w');
  await aimAtPhone(page);
  await expect(page.getByText('E · Use desk phone')).toBeVisible();
  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'Collections desk phone' });
  await expect(dialog.getByTestId('phone-status')).toHaveText('Idle · no call');
  // Plain next start has no demo host: the card reads unknown/not prepared, never open.
  const card = dialog.getByRole('region', { name: 'Pre-call check' });
  await expect(card).toHaveAttribute('data-business', 'unknown');
  await expect(card).toContainText('No Apify evidence recorded');
  await expect(card).toContainText('not prepared');
  // Not ready: Request call is visibly disabled, says why, and clicking it places nothing.
  const request = dialog.getByTestId('phone-request');
  await expect(request).toHaveAttribute('aria-disabled', 'true');
  await expect(request).toHaveAccessibleDescription('Pre-call not ready');
  await expect(dialog.getByTestId('phone-request-gate')).toHaveText('Pre-call not ready');
  await request.click({ force: true });
  await expect(dialog.getByTestId('phone-request-result')).toHaveCount(0);
  if (process.env.BR_SHOTS === '1') await card.screenshot({ path: '/tmp/br-3d/phone-precall.png' });
});
