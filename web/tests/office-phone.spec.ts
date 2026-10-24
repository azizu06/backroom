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
  let p = await pos(page);
  let angle = Math.atan2(-(phone[0] - p.x), -(phone[1] - p.z));
  let diff = Math.atan2(Math.sin(angle - p.yaw), Math.cos(angle - p.yaw));
  for (let i = 0; Math.abs(diff) > 0.06 && i < 40; i++) {
    await page.keyboard.press(diff > 0 ? 'ArrowLeft' : 'ArrowRight');
    p = await pos(page); angle = Math.atan2(-(phone[0] - p.x), -(phone[1] - p.z)); diff = Math.atan2(Math.sin(angle - p.yaw), Math.cos(angle - p.yaw));
  }
}
test('collections desk phone plays a mock callback and keeps call requests unavailable', async ({ page }) => {
  const shots = process.env.BR_SHOTS === '1';
  if (shots) await mkdir('/tmp/br-3d', { recursive: true });
  const calls: { url: string; type: string }[] = [];
  page.on('request', request => calls.push({ url: request.url(), type: request.resourceType() }));
  if (shots) {
    await page.goto('/office?calls=mock&callsSpeed=slow');
    await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/br-3d/phone-overview.png' });
  }
  await page.goto('/office?calls=mock&callsSpeed=fast');
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await select.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
  // Pass the collections doorway between its posts, then move to the phone's aisle-side x.
  await page.keyboard.down('w');
  await expect.poll(async () => (await pos(page)).z).toBeLessThan(-1.0);
  await page.keyboard.up('w');
  await walkX(page, -4.2);
  await page.keyboard.down('w');
  await expect.poll(async () => (await pos(page)).z).toBeLessThan(-1.9);
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
  await expect.poll(() => dialog.getByTestId('phone-status').innerText(), { timeout: 15_000, intervals: [100] }).toContain('Ended');
  if (shots) await page.screenshot({ path: '/tmp/br-3d/phone-ended.png' });
  await dialog.getByTestId('phone-request').click();
  await expect(dialog.getByTestId('phone-request-result')).toHaveText('Call requests not available yet');
  if (shots) await page.screenshot({ path: '/tmp/br-3d/phone-request.png' });
  expect(calls.filter(({ url, type }) => /call/i.test(url) && !['document', 'script', 'stylesheet', 'font', 'image'].includes(type))).toEqual([]);
});

test('phone stays idle without the mock query', async ({ page }) => {
  await page.goto('/office');
  const select = page.getByLabel('Office view');
  await select.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeVisible();
  // Target is already within reach at spawn only after approaching the Collections desk.
  await page.keyboard.down('w'); await expect.poll(async () => (await pos(page)).z).toBeLessThan(-1.0); await page.keyboard.up('w');
  await walkX(page, -4.2);
  await page.keyboard.down('w'); await expect.poll(async () => (await pos(page)).z).toBeLessThan(-1.9); await page.keyboard.up('w');
  await aimAtPhone(page);
  await expect(page.getByText('E · Use desk phone')).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.getByRole('dialog', { name: 'Collections desk phone' }).getByTestId('phone-status')).toHaveText('Idle · no call');
});
