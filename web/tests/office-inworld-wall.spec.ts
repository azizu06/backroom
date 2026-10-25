import { AUDIT_WALL } from '../lib/office/props/auditWall';
import { INBOX_TRAY } from '../lib/office/targets/inbox';
import { workspaceRoute, ROOM_SPAWNS, type Vec2 } from '../lib/office/layout';
import { OFFICE_ANCHORS } from '../lib/office/state';
import { test, expect, type Page } from '@playwright/test';
import { TICKET_BOARD, TICKET_BOARD_POSITION } from '../lib/office/props/ticketBoard';
import { BUILDING } from '../lib/office/layout';
import { openMenu } from './office-menu';

// Run via test:office:browser after building the web app. Needs WebGL; fails loudly without it.
function surface(page: Page) {
  return page.getByRole('application', { name: /First-person office/ });
}
async function requireWebGL(page: Page) {
  const available = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  if (!available) throw new Error('WebGL is unavailable in this headless Chromium, so the first-person Play view cannot render.');
}
async function player(page: Page) {
  return surface(page).evaluate(element => {
    const { playerX, playerZ, playerYaw } = (element as HTMLElement).dataset;
    if (playerX === undefined || playerZ === undefined || playerYaw === undefined) throw new Error('Play rig has not reported a position (3D scene not rendering?)');
    return { x: Number(playerX), z: Number(playerZ), yaw: Number(playerYaw) };
  });
}
type Release =
  | { kind: 'turned'; yaw: number }
  | { kind: 'facing'; x: number; z: number; sign: number }
  | { kind: 'arrived'; x: number; z: number; tolerance: number };
/** Holds `key` until the release condition holds, checked in the page on every animation frame. */
async function holdInPage(page: Page, key: string, release: Release, timeout = 15_000) {
  await page.keyboard.down(key);
  try {
    await page.waitForFunction(r => {
      const element = document.querySelector<HTMLElement>('[data-player-yaw]');
      if (!element) return false;
      const x = Number(element.dataset.playerX), z = Number(element.dataset.playerZ), yaw = Number(element.dataset.playerYaw);
      if (r.kind === 'turned') return yaw !== r.yaw;
      const raw = Math.atan2(-(r.x - x), -(r.z - z)) - yaw;
      const diff = Math.atan2(Math.sin(raw), Math.cos(raw));
      if (r.kind === 'facing') return Math.abs(diff) <= 0.3 || Math.sign(diff) !== r.sign;
      return Math.hypot(r.x - x, r.z - z) <= r.tolerance || Math.abs(diff) > 0.2;
    }, release, { polling: 'raf', timeout });
  } finally {
    await page.keyboard.up(key);
  }
}
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
/** Yaw 0 looks toward -z; forward = (-sin yaw, -cos yaw). */
async function bearingTo(page: Page, x: number, z: number) {
  const p = await player(page);
  return { diff: wrap(Math.atan2(-(x - p.x), -(z - p.z)) - p.yaw), distance: Math.hypot(x - p.x, z - p.z) };
}
async function face(page: Page, x: number, z: number, tolerance = 0.12) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const { diff } = await bearingTo(page, x, z);
    if (Math.abs(diff) <= tolerance) return;
    // ArrowLeft turns left (yaw increases), ArrowRight turns right.
    const key = diff > 0 ? 'ArrowLeft' : 'ArrowRight';
    if (Math.abs(diff) > 0.35) await holdInPage(page, key, { kind: 'facing', x, z, sign: Math.sign(diff) });
    else await holdInPage(page, key, { kind: 'turned', yaw: (await player(page)).yaw });
  }
  const { diff } = await bearingTo(page, x, z);
  expect(Math.abs(diff)).toBeLessThanOrEqual(tolerance * 2);
}
async function walkTo(page: Page, x: number, z: number, tolerance = 0.2) {
  for (let leg = 0; leg < 12; leg++) {
    if ((await bearingTo(page, x, z)).distance <= tolerance) return;
    await face(page, x, z);
    await holdInPage(page, 'w', { kind: 'arrived', x, z, tolerance });
  }
  expect((await bearingTo(page, x, z)).distance).toBeLessThanOrEqual(tolerance * 2);
}
/** Follow the same grid aisles as agents/story; never hard-code the retired room corridors. */
async function followRoute(page: Page, target: Vec2) {
  const at = await player(page);
  const route = workspaceRoute([at.x, at.z], target);
  expect(route.at(-1)).toEqual(target);
  for (const [x, z] of route.slice(1)) await walkTo(page, x, z);
}
async function startPlay(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
  await requireWebGL(page);
  // Retry until hydrated: a click before hydration is a no-op. The denial adds a real preview audit row.
  await expect(async () => {
    // Preview controls and receipts live in Full Floor; department scene labels were removed.
    await page.getByRole('navigation', { name: 'Office shortcuts' }).getByRole('button', { name: 'Full Floor', exact: true }).click();
    await page.getByRole('button', { name: 'Preview Treasury denial' }).click();
    await expect(page.locator('[data-audit-id]').first()).toContainText('DENY', { timeout: 500 });
  }).toPass();
  await page.keyboard.press('Escape');
  const select = page.getByLabel('Office view');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await select.selectOption('tween');
  await expect(select).toHaveValue('tween');
  await select.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/, { timeout: 15_000 });
  return errors;
}

test('the audit wall hangs in the lobby and, on a preview feed, paints no receipts and says so', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = await startPlay(page);
  const canvas = page.getByTestId('office-viewport').locator('canvas');

  await followRoute(page, [AUDIT_WALL.x + 0.9, AUDIT_WALL.z]);
  await face(page, AUDIT_WALL.x, AUDIT_WALL.z);
  const at = await player(page);
  expect(at.x).toBeGreaterThan(AUDIT_WALL.x);

  // Local rows are not the audit log, so the wall paints none of them and says so (live ids are covered by the unit tests).
  expect(await canvas.getAttribute('data-audit-wall')).toBe('');
  const description = await canvas.getAttribute('aria-description');
  expect(description).toContain('No audit entries in this view');
  const denialId = await page.locator('[data-audit-id]').first().getAttribute('data-audit-id');
  expect(denialId).not.toBeNull();
  expect(description).not.toContain(denialId!);
  await expect(page.locator('.play-prompt')).toHaveText(''); // reading needs no interaction
  expect(errors).toEqual([]);
});

test('the inbox tray sits on the Payables desk: walk up, see E: open, open the inbox page', async ({ page }) => {
  // Longest walk in the suite; headless software WebGL renders slowly.
  test.setTimeout(180_000);
  const errors = await startPlay(page);
  const canvas = page.getByTestId('office-viewport').locator('canvas');
  await expect(canvas).toHaveAttribute('data-inbox-prompt', '');

  await followRoute(page, [INBOX_TRAY[0], INBOX_TRAY[1] + 2]);
  await expect(canvas).toHaveAttribute('data-inbox-prompt', '');
  await walkTo(page, INBOX_TRAY[0], INBOX_TRAY[1] + 1);
  await face(page, ...INBOX_TRAY);
  await expect(page.getByText('E · Open inbox tray · 3 in inbox')).toBeVisible();
  await expect(canvas).toHaveAttribute('data-inbox-prompt', 'E: open');

  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'Inbox tray' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('3 in inbox');
  await expect(dialog).toContainText('3 intake items are counted'); // preview carries no receipts; not shown as an empty inbox
  await expect(dialog.getByRole('button', { name: /^Close/ })).toBeFocused();
  expect(errors).toEqual([]);

  await dialog.getByRole('link', { name: 'Open the full inbox tray' }).click();
  await expect(page).toHaveURL(/\/inbox$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('tickets are mounted at spawn and the nearby E prompt opens the existing inbox panel', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=play');
  await requireWebGL(page);
  const gate = page.getByRole('dialog', { name: 'Backroom', exact: true });
  await expect(gate).toBeVisible();
  await gate.getByRole('button', { name: 'Enter', exact: true }).click();
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
  const canvas = page.getByTestId('office-viewport').locator('canvas');
  // The same model paints the texture and its accessible scene text, before taking a step.
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute('data-ticket-board', /Queued · \d+[\s\S]*In progress · \d+[\s\S]*Needs you · \d+[\s\S]*Done · \d+/);
  await expect(page.getByTestId('ticket-board')).toHaveAttribute('aria-label', /Preview · sample tickets/);
  await expect(page.locator('.play-minimap title').filter({ hasText: /^Tickets$/ })).toHaveCount(1);
  await expect(page.locator('.play-prompt')).not.toContainText('Open tickets');
  // Use the west pod's clear side aisle, then the clear strip along the north wall.
  await walkTo(page, -5, 0.6);
  await walkTo(page, -5, BUILDING.minZ + 1.5);
  await walkTo(page, TICKET_BOARD.x, TICKET_BOARD_POSITION[1] + 0.8);
  await face(page, ...TICKET_BOARD_POSITION);
  await expect(page.getByText('E · Open tickets', { exact: true })).toBeVisible();
  await page.keyboard.press('e');
  const dialog = page.getByRole('dialog', { name: 'Inbox tray' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open the full inbox tray' })).toHaveAttribute('href', '/inbox');
  expect(errors).toEqual([]);
});
