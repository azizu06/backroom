import { test, expect, type Page } from '@playwright/test';
import { openMenu, openSheet } from './office-menu';
import { createMockOfficeState } from '../lib/office/preview';

// O toggles first person; Map opens the quick actions while keeping Play mounted.
function surface(page: Page) {
  return page.getByRole('application', { name: /First-person office/ });
}

async function openOverview(page: Page, errors: string[]) {
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await openMenu(page);
}

test('O toggles first person and the Play button does the same', async ({ page }) => {
  const errors: string[] = [];
  await openOverview(page, errors);
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await page.keyboard.press('o');
  await expect(surface(page)).toBeFocused();
  await expect(select).toHaveValue('play');
  // O in first person returns to the overhead view.
  await page.keyboard.press('o');
  await expect(surface(page)).toHaveCount(0);
  await expect(select).toHaveValue('walk');
  await openMenu(page);
  await page.getByRole('button', { name: 'Play (First Person)', exact: true }).click();
  await expect(surface(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(surface(page)).toHaveCount(0);
  // Typing O into a field never toggles.
  await select.focus();
  await page.keyboard.press('o');
  await expect(surface(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Rooms sheet focuses a room and opens its inspector', async ({ page }) => {
  const errors: string[] = [];
  await openOverview(page, errors);
  await openSheet(page, 'rooms');
  await page.getByRole('button', { name: /^Payables/ }).click();
  const inspector = page.locator('.room-inspector');
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText('Payables');
  expect(errors).toEqual([]);
});

test('O leaves the view unchanged while keyboard shortcuts has focus', async ({ page }) => {
  await page.goto('/office?view=overview');
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('office-viewport').getByText('Loading 3D office…')).toHaveCount(0);
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
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

async function startPlay(page: Page) {
  await page.goto('/office?view=overview');
  await openMenu(page);
  await page.getByTestId('office-topbar').getByRole('button', { name: 'Play (First Person)', exact: true }).click();
  const splash = page.getByTestId('play-splash');
  if (await splash.isVisible()) await splash.getByRole('button', { name: 'Enter', exact: true }).click();
  await expect(surface(page)).toHaveAttribute('data-player-fov', /\d/, { timeout: 30_000 });
}

async function playerPosition(page: Page) {
  return [Number(await surface(page).getAttribute('data-player-x')), Number(await surface(page).getAttribute('data-player-z'))];
}

async function pickAgentOnMap(page: Page, id: string) {
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const map = page.getByRole('region', { name: 'Office Overview', exact: true });
  await expect(map).toBeVisible();
  await map.locator(`.overview-map-agent[data-agent="${id}"]`).click();
  return map;
}

test('Map Go here teleports the mounted player beside each agent with the E prompt', async ({ page }) => {
  await startPlay(page);
  // PlayRig increments this at mount; the HUD can survive a rig remount.
  const canvas = page.getByTestId('office-viewport').locator('canvas');
  await expect(canvas).toHaveAttribute('data-play-rig-mount-count', /\d/);
  const mounts = (await canvas.getAttribute('data-play-rig-mount-count'))!;
  const agents = createMockOfficeState().source.getSnapshot().agents;
  for (const agent of agents) {
    const before = await playerPosition(page);
    const map = await pickAgentOnMap(page, agent.id);
    await page.locator('[role=menuitem][data-action=go]').click();
    await expect(map).toHaveCount(0);
    await expect.poll(async () => {
      const [x, z] = await playerPosition(page);
      return Math.hypot(x! - agent.pos[0], z! - agent.pos[1]);
    }, { timeout: 30_000 }).toBeLessThanOrEqual(1.5);
    expect(await playerPosition(page)).not.toEqual(before);
    await expect(page.locator('.play-crosshair')).toHaveAttribute('data-kind', 'agent');
    await expect(page.locator('.play-prompt')).toContainText(`Talk to ${agent.name}`);
    await expect(page.locator('.play-prompt')).toContainText('E');
    await expect(page.locator('.play-prompt')).toBeVisible();
    await expect(surface(page)).toBeFocused();
    await expect(canvas).toHaveAttribute('data-play-rig-mount-count', mounts);
  }
});

test('Map First person in a second Play session closes the map without restoring the old exit pose', async ({ page }) => {
  await startPlay(page);
  const previousExit = await playerPosition(page);
  await surface(page).focus();
  await page.keyboard.press('o');
  await expect(surface(page)).toHaveCount(0);
  await page.keyboard.press('o');
  await expect(surface(page)).toHaveAttribute('data-player-fov', /\d/, { timeout: 30_000 });
  expect(await playerPosition(page)).toEqual(previousExit);

  const agent = createMockOfficeState().source.getSnapshot().agents[0]!;
  await pickAgentOnMap(page, agent.id);
  await page.locator('[role=menuitem][data-action=go]').click();
  await expect.poll(() => playerPosition(page)).not.toEqual(previousExit);
  await expect(page.locator('.play-prompt')).toContainText(`Talk to ${agent.name}`);
  const before = await playerPosition(page);
  const yaw = (await surface(page).getAttribute('data-player-yaw'))!;
  const canvas = page.getByTestId('office-viewport').locator('canvas');
  const mounts = (await canvas.getAttribute('data-play-rig-mount-count'))!;
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const map = page.getByRole('region', { name: 'Office Overview', exact: true });
  await map.getByRole('button', { name: /^First person/ }).click();
  await expect(map).toHaveCount(0);
  // Let any erroneously queued teleport reach the camera and HUD before checking the pose.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await playerPosition(page)).toEqual(before);
  await expect(surface(page)).toHaveAttribute('data-player-yaw', yaw);
  await expect(canvas).toHaveAttribute('data-play-rig-mount-count', mounts);
});

test('Map Talk opens the same agent conversation as E without moving the player', async ({ page }) => {
  await startPlay(page);
  const agent = createMockOfficeState().source.getSnapshot().agents[0]!;
  const before = await playerPosition(page);
  const map = await pickAgentOnMap(page, agent.id);
  await page.locator('[role=menuitem][data-action=talk]').click();
  await expect(map).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: `Talking with ${agent.name}`, exact: true })).toBeVisible();
  await expect(page.locator('.play-panel[data-target-kind=agent]')).toBeVisible();
  expect(await playerPosition(page)).toEqual(before);
});


test('FloorPlan uses Play quick actions after context loss and inspect outside Play', async ({ page }) => {
  await startPlay(page);
  await page.getByTestId('office-viewport').locator('canvas').evaluate(canvas => {
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  });
  const plan = page.locator('.floor-plan');
  await expect(plan).toBeVisible();
  const agent = createMockOfficeState().source.getSnapshot().agents[0]!;
  await plan.getByRole('button', { name: new RegExp(agent.name) }).click();
  await expect(page.locator('[role=menuitem][data-action=go]')).toBeVisible();
  await page.locator('[role=menuitem][data-action=talk]').click();
  const dialog = page.getByRole('dialog', { name: `Talking with ${agent.name}`, exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: `Close Talking with ${agent.name}` }).click();
  await plan.locator('.plan-room').filter({ hasText: 'Collections' }).click();
  await expect(page.locator('[role=menuitem][data-action=go]')).toBeVisible();
  await expect(page.locator('[role=menuitem][data-action=talk]')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByLabel('Office view').selectOption('plan');
  await plan.locator('.plan-room').filter({ hasText: 'Collections' }).click();
  await expect(page.locator('.room-inspector')).toContainText('Collections');
  await expect(page.getByRole('menu')).toHaveCount(0);
});
