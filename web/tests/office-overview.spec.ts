import { test, expect, type Page } from '@playwright/test';
import { openMenu, openSheet } from './office-menu';

// O toggles first person; in Play, O opens the 2D overview map. Room inspector replaces the old corner quick-menu.
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
  // O in first person opens the Overview map.
  await page.keyboard.press('o');
  await expect(surface(page)).toHaveCount(0);
  await expect(select).toHaveValue('walk');
  const map = page.getByRole('region', { name: 'Office overview' });
  await expect(map).toBeVisible();
  await expect(map.locator('.overview-map-room')).toHaveCount(6);
  await expect(map.locator('.overview-map-agent')).toHaveCount(3);
  await page.keyboard.press('Escape');
  await expect(map).toHaveCount(0);
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

async function dragOrbit(page: Page) {
  const viewport = page.getByTestId('office-viewport');
  await expect(viewport).toHaveAttribute('data-office-azimuth', /-?\d/, { timeout: 30_000 });
  const before = Number(await viewport.getAttribute('data-office-azimuth'));
  const box = await viewport.locator('canvas').boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height * 0.65;
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Drag right to decrease azimuth: home (~0.65) has room toward -0.7.
  await page.mouse.move(x + 200, y, { steps: 20 });
  await page.mouse.up();
  await expect.poll(async () => before - Number(await viewport.getAttribute('data-office-azimuth')), { timeout: 10_000 }).toBeGreaterThanOrEqual(0.1);
  const after = Number(await viewport.getAttribute('data-office-azimuth'));
  expect(after).toBeGreaterThanOrEqual(-0.7);
  expect(after).toBeLessThanOrEqual(0.9);
}

test.describe('explicit orbit camera with reduced motion', () => {
  test.use({ reducedMotion: 'reduce', viewport: { width: 1440, height: 1000 } });
  test.setTimeout(60_000);

  test('selecting Orbit Camera enables a 200 px canvas drag and keeps wheel zoom disabled', async ({ page }) => {
    await page.goto('/office?view=overview');
    await page.getByLabel('Office view').selectOption({ label: 'Orbit Camera' });
    await dragOrbit(page);
    const viewport = page.getByTestId('office-viewport');
    const before = Number(await viewport.getAttribute('data-office-zoom'));
    await page.mouse.wheel(0, -400);
    await expect(viewport).toHaveAttribute('data-office-zoom', String(before));
    await expect(page.locator('.room-inspector')).toHaveCount(0);
  });

  test('caption and selected view match, and the fixed caption focuses the picker', async ({ page }) => {
    await page.goto('/office?view=overview');
    const select = page.getByLabel('Office view');
    const caption = page.locator('.office-caption');
    await expect(select).toHaveValue('tween');
    await expect(caption).toHaveText('Fixed camera · pick Orbit camera to look around');
    await caption.getByRole('button').click();
    await expect(select).toBeFocused();
    await select.selectOption('walk');
    await expect(caption).toHaveText('Drag to look around · choose a room to focus');
    await select.selectOption('plan');
    await expect(caption).toHaveText('Floor plan · same subscribed state');
    await select.selectOption('tween');
    await expect(caption).toHaveText('Fixed camera · pick Orbit camera to look around');
    await page.getByRole('button', { name: 'Full Screen', exact: true }).click();
    await caption.getByRole('button').click();
    await expect(page.locator('#office-view-fullscreen')).toBeFocused();
  });

  test('focusing a room moves the target and leaves orbit enabled', async ({ page }) => {
    await page.goto('/office?view=overview');
    const select = page.getByLabel('Office view');
    await select.selectOption('walk');
    const viewport = page.getByTestId('office-viewport');
    await expect(viewport).toHaveAttribute('data-office-target-x', /-?\d/, { timeout: 30_000 });
    const before = [await viewport.getAttribute('data-office-target-x'), await viewport.getAttribute('data-office-target-z')];
    await openSheet(page, 'rooms');
    await page.getByRole('button', { name: /^Payables/ }).click();
    const inspector = page.locator('.room-inspector');
    await expect(inspector).toContainText('Payables');
    await expect.poll(async () => [await viewport.getAttribute('data-office-target-x'), await viewport.getAttribute('data-office-target-z')], { timeout: 10_000 }).not.toEqual(before);
    await inspector.getByRole('button', { name: /^Close .* details$/ }).click();
    await expect(select).toHaveValue('walk');
    await dragOrbit(page);
  });
});

test.describe('touch orbit camera', () => {
  test.use({ hasTouch: true, reducedMotion: 'reduce', viewport: { width: 720, height: 1000 } });
  test.setTimeout(60_000);

  test('one finger rotates and pinch zoom stays disabled after choosing orbit on a narrow screen', async ({ page, context }) => {
    await page.goto('/office?view=overview');
    const select = page.getByLabel('Office view');
    await expect(select).toHaveValue('tween');
    await select.selectOption('walk');
    const viewport = page.getByTestId('office-viewport');
    await expect(viewport).toHaveAttribute('data-office-azimuth', /-?\d/, { timeout: 30_000 });
    const before = Number(await viewport.getAttribute('data-office-azimuth'));
    const box = await viewport.locator('canvas').boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height * 0.6;
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    for (let step = 1; step <= 10; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + step * 20, y, id: 1 }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => before - Number(await viewport.getAttribute('data-office-azimuth')), { timeout: 10_000 }).toBeGreaterThanOrEqual(0.1);
    const after = Number(await viewport.getAttribute('data-office-azimuth'));
    expect(after).toBeGreaterThanOrEqual(-0.7);
    expect(after).toBeLessThanOrEqual(0.9);
    const zoom = Number(await viewport.getAttribute('data-office-zoom'));
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 40, y, id: 1 }, { x: x + 40, y, id: 2 }] });
    for (let step = 1; step <= 5; step++) {
      const spread = 40 + step * 8;
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - spread, y, id: 1 }, { x: x + spread, y, id: 2 }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(viewport).toHaveAttribute('data-office-zoom', String(zoom));
    await session.detach();
  });
});
