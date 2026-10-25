import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PHONE_INTERACTION } from '../lib/office/props/phone';

// The operator code from the env, else this worktree's owned host (`.demo/private.env`). Never printed.
const code = process.env.SINGLE_ORIGIN_CODE
  || /^CONTROLLER_ENROLLMENT_SECRET=(.+)$/m.exec(readFileSync(join(__dirname, '../../.demo/private.env'), 'utf8'))?.[1] || '';

const surface = (page: Page) => page.getByRole('application', { name: /First-person office/ });
const pos = (page: Page) => surface(page).evaluate(el => ({ x: Number((el as HTMLElement).dataset.playerX), z: Number((el as HTMLElement).dataset.playerZ), yaw: Number((el as HTMLElement).dataset.playerYaw) }));
async function hold(page: Page, key: string, until: (p: Awaited<ReturnType<typeof pos>>) => boolean) {
  await page.keyboard.down(key);
  try { await expect.poll(async () => until(await pos(page)), { timeout: 15_000 }).toBe(true); } finally { await page.keyboard.up(key); }
}
/** The desk-phone walk from office-phone.spec.ts, kept coarse: approach the Collections desk, then turn toward the phone. */
async function openDeskPhone(page: Page) {
  await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeVisible();
  await hold(page, 'w', p => p.z < -1.0);
  for (let i = 0; i < 20; i++) {
    const p = await pos(page); if (Math.abs(p.x + 4.2) < 0.08) break;
    await hold(page, p.x > -4.2 ? 'a' : 'd', n => p.x > -4.2 ? n.x <= -4.12 : n.x >= -4.28);
  }
  await hold(page, 'w', p => p.z < -1.9);
  const phone = PHONE_INTERACTION.position;
  for (let i = 0; i < 16; i++) {
    const p = await pos(page);
    const diff = Math.atan2(Math.sin(Math.atan2(-(phone[0] - p.x), -(phone[1] - p.z)) - p.yaw), Math.cos(Math.atan2(-(phone[0] - p.x), -(phone[1] - p.z)) - p.yaw));
    if (Math.abs(diff) <= 0.2) break;
    await page.keyboard.down(diff > 0 ? 'ArrowLeft' : 'ArrowRight'); await page.waitForTimeout(40); await page.keyboard.up(diff > 0 ? 'ArrowLeft' : 'ArrowRight');
  }
  await expect(page.getByText('E · Use desk phone')).toBeVisible();
  await page.keyboard.press('e');
  return page.getByRole('dialog', { name: 'Collections desk phone' });
}

test('one origin: live office state, one operator sign-in, and the desk phone Request call', async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  expect(code, 'operator code').not.toBe('');
  const origin = new URL(baseURL!), sockets: string[] = [];
  page.on('websocket', socket => sockets.push(socket.url()));

  await page.goto('/office');
  await expect(page.locator('.connection-status')).toHaveText('State connected', { timeout: 20_000 });
  // The office subscribed through its own origin, the only address a public browser can reach.
  expect(sockets.length).toBeGreaterThan(0);
  for (const url of sockets) expect(url.startsWith(`${origin.protocol === 'https:' ? 'wss' : 'ws'}://${origin.host}/__state/`), url).toBe(true);

  // One sign-in on the public origin unlocks the console, then every other operator surface without asking again.
  await page.goto('/operator');
  await page.getByLabel('Operator code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Operator session active.')).toBeVisible();
  await page.goto('/audit');
  await expect(page.getByText(/^Chain verified · \d+ entries$/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Operator code')).toHaveCount(0);
  await page.goto('/policy');
  await expect(page.getByText(/^Saved policy v\d+$/)).toBeVisible({ timeout: 10_000 });

  await page.goto('/office');
  await expect(page.locator('.connection-status')).toHaveText('State connected', { timeout: 20_000 });
  const phone = await openDeskPhone(page);
  // Without ready pre-call evidence the desk phone keeps Request call disabled; the dial gate is tested once it is ready.
  const request = phone.getByTestId('phone-request');
  await expect(request).toHaveAttribute('aria-disabled', /true|false/);
  if (await request.getAttribute('aria-disabled') === 'true') {
    await expect(phone.getByTestId('phone-request-gate')).toContainText(/Pre-call not ready|Blocked|Paused/);
    return;
  }
  await request.click();
  // Signed in from the public origin: the request reaches the dial gate, not "Calls are locked".
  // Without a voice relay on this host nothing rings.
  await expect(phone.getByTestId('phone-request-result')).not.toContainText('locked');
  await expect(phone.getByTestId('phone-request-result')).toContainText(/No call placed|Ringing the allowlisted demo phone/);
});
