import { test, expect, type Page } from '@playwright/test';
import { openMenu } from './office-menu';

// HUD variant (c) Overview: O toggles the overhead 3D camera and first person; agents and desks open quick actions.
function surface(page: Page) {
  return page.getByRole('application', { name: /First-person office/ });
}
async function pose(page: Page) {
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
  return surface(page).evaluate(element => {
    const { playerX, playerZ, playerYaw } = (element as HTMLElement).dataset;
    return { x: Number(playerX), z: Number(playerZ), yaw: Number(playerYaw) };
  });
}
async function openOverview(page: Page, errors: string[]) {
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Backroom menu' })).toBeVisible();
}
/** Alex's seat (OFFICE_ANCHORS.collections.position), where the preview keeps him. */
const ALEX = { x: -5, z: -1.8 };

test('O toggles Overview and first person, and the buttons do the same', async ({ page }) => {
  const errors: string[] = [];
  await openOverview(page, errors);
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await page.keyboard.press('o');
  await expect(surface(page)).toBeFocused();
  await expect(select).toHaveValue('play');
  const start = await pose(page);
  // O in first person opens the Overview map: every room a tile, agents on it; never shown in first person.
  await page.keyboard.press('o');
  await expect(surface(page)).toHaveCount(0);
  await expect(select).toHaveValue('walk');
  const map = page.getByRole('region', { name: 'Office overview' });
  await expect(map).toBeVisible();
  await expect(map.locator('.overview-map-room')).toHaveCount(6);
  await expect(map.locator('.overview-map-agent')).toHaveCount(3);
  await expect(map.locator('.overview-map-room').first()).toBeFocused();
  // O again: back to first person, where it was left.
  await page.keyboard.press('o');
  await expect(surface(page)).toBeFocused();
  await expect(map).toHaveCount(0);
  const resumed = await pose(page);
  expect(Math.hypot(resumed.x - start.x, resumed.z - start.z)).toBeLessThan(0.05);
  // The (keyboard-reachable) Overview button in first person does the same; Escape closes the map to the 3D view.
  await page.getByRole('button', { name: /^Overview/ }).click();
  await expect(map).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(map).toHaveCount(0);
  await expect(select).toHaveValue('walk');
  await expect(page.getByRole('button', { name: 'Backroom menu' })).toBeFocused();
  // The corner menu's Enter first person button enters first person too.
  await openMenu(page);
  await page.getByRole('button', { name: /first person/i }).click();
  await expect(surface(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(surface(page)).toHaveCount(0);
  // Typing O into a field never toggles.
  await openMenu(page);
  await select.focus();
  await page.keyboard.press('o');
  await expect(surface(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Overview quick menu: Go here lands in first person beside the agent, facing them', async ({ page }) => {
  const errors: string[] = [];
  await openOverview(page, errors);
  const alex = page.getByRole('button', { name: /^Alex,/ });
  await alex.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: /Alex/ });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /^Go here/ })).toBeFocused();
  // Escape closes and returns focus to the tag.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(alex).toBeFocused();

  await page.keyboard.press('Enter');
  await menu.getByRole('menuitem', { name: /^Go here/ }).press('Enter');
  await expect(surface(page)).toBeFocused();
  const at = await pose(page);
  const distance = Math.hypot(at.x - ALEX.x, at.z - ALEX.z);
  expect(distance).toBeGreaterThan(0.6);
  expect(distance).toBeLessThan(1.6);
  // Facing him: yaw 0 looks toward -z (play.ts forwardOf).
  const bearing = Math.atan2(-(ALEX.x - at.x), -(ALEX.z - at.z));
  expect(Math.abs(Math.atan2(Math.sin(at.yaw - bearing), Math.cos(at.yaw - bearing)))).toBeLessThan(0.05);
  await expect(page.getByText('E · Talk to Alex')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Overview map: an agent tile offers Go here, which lands in first person next to them', async ({ page }) => {
  const errors: string[] = [];
  await openOverview(page, errors);
  await openMenu(page);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const map = page.getByRole('region', { name: 'Office overview' });
  await map.getByRole('button', { name: /^Alex,/ }).click();
  const menu = page.getByRole('menu', { name: /Alex/ });
  await menu.getByRole('menuitem', { name: /^Go here/ }).click();
  await expect(surface(page)).toBeFocused();
  await expect(map).toHaveCount(0);
  const at = await pose(page);
  expect(Math.hypot(at.x - ALEX.x, at.z - ALEX.z)).toBeLessThan(1.6);
  await expect(page.getByText('E · Talk to Alex')).toBeVisible();
  // A room tile offers Talk to the seated agent.
  await page.keyboard.press('o');
  await map.getByRole('button', { name: /^Payables/ }).click();
  await page.getByRole('menu', { name: /Payables/ }).getByRole('menuitem', { name: /^Talk to Sam/ }).click();
  await expect(page.getByRole('dialog', { name: 'Talking with Sam' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Overview quick menu: Talk opens the agent talk panel without walking', async ({ page }) => {
  const errors: string[] = [];
  await openOverview(page, errors);
  const alex = page.getByRole('button', { name: /^Alex,/ });
  await alex.click();
  await page.getByRole('menu', { name: /Alex/ }).getByRole('menuitem', { name: /^Talk/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Talking with Alex' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Close/ })).toBeFocused();
  await expect(dialog.locator('.agent-talk-line')).toContainText('Reviewing invoice 1042');
  await expect(surface(page)).toHaveCount(0);
  await expect(page.getByLabel('Office view')).toHaveValue('walk');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(alex).toBeFocused();

  // A desk label opens the same menu with Talk to the seated agent and Details.
  await page.locator('.desk-label', { hasText: 'Payables' }).click();
  const desk = page.getByRole('menu', { name: /Payables/ });
  await expect(desk.getByRole('menuitem', { name: /^Talk to Sam/ })).toBeVisible();
  await desk.getByRole('menuitem', { name: /^Details/ }).click();
  await expect(page.locator('.room-inspector')).toBeVisible();
  expect(errors).toEqual([]);
});

test('O leaves the view unchanged while keyboard shortcuts has focus', async ({ page }) => {
  await page.goto('/office?view=overview');
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  // O is the Overview key only once the 3D overview is showing (the scene loads lazily).
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('office-viewport').getByText('Loading 3D office…')).toHaveCount(0);
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(help.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('o');
  await expect(help).toBeVisible();
  await expect(select).toHaveValue('walk');
  await expect(page.getByRole('application', { name: /First-person office/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(help).not.toBeVisible();
  await page.keyboard.press('o');
  await expect(select).toHaveValue('play');
});
