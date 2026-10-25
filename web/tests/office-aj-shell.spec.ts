import { mkdir } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

// Reference: BR-AJ-SOURCE 1f5ea2be9ce6. Run against the refreshed integrated build.
const out = '/tmp/backrooms-aj-current';
const surface = (page: Page) => page.getByRole('application', { name: /First-person office/ });
async function capture(page: Page, name: string) {
  await mkdir(out, { recursive: true });
  await page.screenshot({ path: `${out}/${test.info().project.name}-${name}.png` });
}
async function ready(page: Page) {
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/);
}
async function chrome(page: Page) {
  await expect(page.locator('.office-toolbar:visible')).toHaveCount(1);
  // Count actual headers/nav at any nesting depth, including untagged layout chrome.
  // Sidebar navigation, sheet headers and the Info/scene HUD are legitimate separate regions.
  const bars = await page.locator('header:visible, nav:visible, [role="banner"]:visible, .site-nav:visible, .office-toolbar:visible, [data-testid="office-topbar"]:visible').evaluateAll(elements => {
    const candidates = elements.filter(el => !el.closest('aside, [role="complementary"], [role="dialog"], .office-viewport, .office-footer'));
    return candidates.filter(el => !candidates.some(other => other !== el && other.contains(el)))
      .map(el => ({ tag: el.tagName, classes: el.className, toolbar: el.matches('.office-toolbar') }));
  });
  expect(bars, 'one visible site header/topnav, including untagged duplicates').toHaveLength(1);
  expect(bars[0]?.toolbar).toBe(true);
  const boxes = await page.evaluate(() => {
    const top = document.querySelector('.office-toolbar')!.getBoundingClientRect();
    const view = document.querySelector('[data-testid="office-viewport"]')!.getBoundingClientRect();
    return { topBottom: top.bottom, viewTop: view.top, left: view.left, right: view.right, bottom: view.bottom,
      width: innerWidth, height: innerHeight, scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      scrollHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) };
  });
  expect(boxes.topBottom).toBeLessThanOrEqual(boxes.viewTop + 1);
  expect(boxes.left).toBeGreaterThanOrEqual(0);
  expect(boxes.right).toBeLessThanOrEqual(boxes.width + 1);
  expect(boxes.bottom).toBeLessThanOrEqual(boxes.height + 1);
  expect(boxes.scrollWidth).toBeLessThanOrEqual(boxes.width + 1);
  expect(boxes.scrollHeight).toBeLessThanOrEqual(boxes.height + 1);
}
async function reachable(control: Locator) {
  // Source mobile pills/toolbars scroll internally; the document must stay in one viewport.
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  expect(await control.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1 && (hit === el || el.contains(hit));
  })).toBe(true);
}
async function overview(page: Page) {
  await chrome(page);
  await expect(page.getByTestId('play-splash')).toHaveCount(0);
  await expect(surface(page)).toHaveCount(0);
  await expect(page.locator('.office-shell')).not.toHaveAttribute('data-hud', 'diegetic');
  await expect(page.locator('.office-corner-toggle:visible, .office-corner-panel:visible, .overview-map:visible, .overview-menu:visible, .agent-tag-pick:visible, .play-panel:visible')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Office shortcuts' })).toBeVisible();
  const toolbar = page.locator('.office-toolbar');
  // Every toolbar item must fit after scrolling, including the legacy full-row status pill.
  await reachable(toolbar.getByLabel('Office view'));
  for (const control of await toolbar.locator('.office-tools > :is(button, label, span, fieldset), .theme-toggle').all()) await reachable(control);
}
async function sheetIcon(page: Page, sheet: Locator) {
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  const box = await sheet.boundingBox();
  expect(box).not.toBeNull();
  const size = page.viewportSize()!;
  // Source sheets are centered beside the sidebar on desktop and bottom aligned on mobile.
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 1);
  const icon = sheet.locator('header .room-icon svg');
  await expect(icon).toBeVisible();
  return icon.evaluate(el => el.outerHTML);
}

test.beforeEach(async ({ context, baseURL }) => {
  // Static local pages/assets only: no cloud requests, API calls, voice, mutations or presence.
  const origin = new URL(baseURL!).origin;
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(origin).hostname);
  await context.route('**/*', route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method()) || /^\/api(?:\/|$)/.test(url.pathname)) return route.abort('blockedbyclient');
    return route.continue();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
});

test('source Rooms picker, single topbar, sheets, Info and light/dark survive desktop/mobile', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?view=overview');
  await overview(page);
  await expect(page.locator('.office-shell')).toHaveAttribute('data-theme', 'light');
  await capture(page, 'overview-light');
  const sidebar = page.locator('.office-sidebar');
  for (const name of ['Full Floor', 'Rooms', 'Audit Wall']) {
    const button = sidebar.getByRole('button', { name, exact: true });
    await reachable(button);
    await expect(button.locator('.room-icon svg')).toBeVisible();
  }
  for (const [name, href] of [['Attack Demo', '/attack'], ['Operator', '/operator'], ['Controller', '/controller'], ['What’s real', '/real-vs-sim']] as const) {
    const link = sidebar.getByRole('link', { name, exact: true });
    await reachable(link);
    await expect(link).toHaveAttribute('href', href);
    await expect(link.locator('.room-icon svg')).toBeVisible();
  }
  const fullFloor = sidebar.getByRole('button', { name: 'Full Floor', exact: true });
  await fullFloor.click();
  const summary = page.getByRole('dialog', { name: 'Today at Backroom' });
  const icons = [await sheetIcon(page, summary)];
  const lightBackground = await summary.evaluate(el => getComputedStyle(el).backgroundColor);
  await expect(summary.getByRole('button', { name: 'Close Today at Backroom' })).toBeFocused();
  await expect(summary.locator('.seat-statuses')).toBeVisible();
  await summary.getByRole('button', { name: 'Preview escalation', exact: true }).click();
  await expect(summary).toContainText('Four installments requested · awaiting Dana');
  await expect(summary.locator('#office-preview-receipts')).toContainText('Invoice 1042');
  await expect(page.locator('#office-preview-receipts')).toHaveCount(1);
  await capture(page, 'overview-summary');
  await page.keyboard.press('Escape');
  await expect(summary).toHaveCount(0);
  const inbox = sidebar.getByRole('button', { name: /^Inbox ·/ });
  await inbox.click();
  const inboxSheet = page.getByRole('dialog', { name: /^Inbox ·/ });
  icons.push(await sheetIcon(page, inboxSheet));
  await expect(inboxSheet.getByRole('link', { name: 'Open the judge inbox' })).toBeVisible();
  await capture(page, 'overview-inbox');
  await page.locator('.detail-sheet-backdrop').click({ position: { x: 2, y: 2 } });
  await expect(inboxSheet).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'Audit Wall', exact: true }).click();
  const auditSheet = page.getByRole('dialog', { name: 'Audit Wall', exact: true });
  icons.push(await sheetIcon(page, auditSheet));
  await expect(auditSheet.locator('#office-audit-wall')).toBeVisible();
  await expect(page.locator('#office-audit-wall')).toHaveCount(1);
  await capture(page, 'overview-audit');
  await auditSheet.getByRole('button', { name: 'Close Audit Wall', exact: true }).click();
  const rooms = sidebar.getByRole('button', { name: 'Rooms', exact: true });
  const picker = page.getByRole('dialog', { name: 'Rooms', exact: true });
  await rooms.click();
  icons.push(await sheetIcon(page, picker));
  expect(new Set(icons).size, 'summary, inbox, audit and picker have distinct source icons').toBe(icons.length);
  const roomIcons: string[] = [];
  const roomNames = ['Lobby', 'Collections', 'Payables', 'Vendor Desk', 'Dana’s Desk', 'Treasury · Locked'];
  for (const name of roomNames) {
    const choice = picker.getByRole('button', { name, exact: true });
    await reachable(choice);
    roomIcons.push(await choice.locator('.room-icon svg').evaluate(el => el.outerHTML));
  }
  expect(new Set(roomIcons).size, 'each room has its own icon').toBe(roomNames.length);
  await capture(page, 'rooms-picker');
  await picker.getByRole('button', { name: 'Close Rooms', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(rooms).toBeFocused();
  for (const name of roomNames) {
    await rooms.click();
    await picker.getByRole('button', { name, exact: true }).click();
    await expect(picker).toHaveCount(0);
    const title = name === 'Treasury · Locked' ? 'Treasury' : name;
    const room = page.getByRole('dialog', { name: title, exact: true });
    await expect(room).toBeVisible();
    await reachable(room.getByRole('button', { name: `Close ${title} details`, exact: true }));
    if (['Collections', 'Payables', 'Vendor Desk'].includes(name)) {
      await expect(room).toContainText('Policy version');
      await room.locator('summary').click();
      await expect(room.locator('details')).toHaveAttribute('open', '');
    } else if (name === 'Treasury · Locked') await expect(room).toContainText('Entry and money movement require server authorization');
    else if (name === 'Dana’s Desk') await expect(room).toContainText('passkey');
    else await expect(room).toContainText('Inbox tray');
    await capture(page, `room-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`);
    await page.keyboard.press('Escape');
    await expect(room).toHaveCount(0);
    await expect(rooms).toBeFocused();
  }
  const disclosure = page.getByRole('complementary', { name: 'Real versus simulated disclosure' });
  await expect(disclosure.getByText('Info', { exact: true })).toBeVisible();
  const details = disclosure.getByRole('button', { name: 'Details', exact: true });
  await reachable(details);
  await expect(details).toHaveAttribute('aria-expanded', 'false');
  await details.click();
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(disclosure.getByRole('region', { name: 'Real integrations' })).toBeVisible();
  await expect(disclosure.getByRole('region', { name: 'Sandbox and simulated' })).toBeVisible();
  const fullPage = disclosure.getByRole('link', { name: /Full page/ });
  await reachable(fullPage);
  await fullPage.click({ trial: true });
  await capture(page, 'overview-info');
  await details.click();
  await expect(disclosure.getByRole('region', { name: 'Sandbox and simulated' })).toBeHidden();
  const dark = page.getByRole('button', { name: 'Switch to dark mode' });
  await reachable(dark);
  await dark.click();
  await expect(page.locator('.office-shell')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('backroom-theme'))).toBe('dark');
  await overview(page);
  await capture(page, 'overview-dark');
  await fullFloor.click();
  await expect(summary).toBeVisible();
  expect(await summary.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(lightBackground);
  await capture(page, 'overview-dark-summary');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('.office-shell')).toHaveAttribute('data-theme', 'dark');
  const light = page.getByRole('button', { name: 'Switch to light mode' });
  await reachable(light);
  await light.click();
  await expect(page.locator('.office-shell')).toHaveAttribute('data-theme', 'light');
  await overview(page);
  await sidebar.getByRole('link', { name: 'Operator', exact: true }).click();
  await expect(page).toHaveURL(/\/operator(?:\?|$)/);
  await page.goto('/office?view=overview');
  await overview(page);
  expect(errors).toEqual([]);
});

test('source splash is once per session, with desktop/mobile entry semantics and Enter', async ({ page }, testInfo) => {
  const gate = page.getByRole('dialog', { name: 'Backroom', exact: true });
  await page.goto('/office');
  if (testInfo.project.name === 'desktop') {
    await expect(gate).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('office.splashSeen'))).toBe('1');
    await capture(page, 'default-splash');
    await gate.getByRole('button', { name: 'Overview (map view)', exact: true }).click();
  } else {
    await overview(page);
    expect(await page.evaluate(() => sessionStorage.getItem('office.splashSeen'))).toBeNull();
  }
  // Explicit ?view=play overrides the compact default. A fresh session flag is local test setup.
  await page.evaluate(() => sessionStorage.removeItem('office.splashSeen'));
  await page.goto('/office?view=play');
  await expect(gate).toBeVisible();
  await reachable(gate.getByRole('button', { name: 'Enter', exact: true }));
  await capture(page, 'enter-splash');
  if (testInfo.project.name === 'desktop') await gate.getByRole('button', { name: 'Enter', exact: true }).click();
  else await gate.getByRole('button', { name: 'Enter', exact: true }).press('Enter');
  await expect(gate).toHaveCount(0);
  await ready(page);
  await page.evaluate(() => document.exitPointerLock?.());
  await page.getByRole('button', { name: 'Exit Play', exact: true }).click();
  await overview(page);
  await page.reload();
  await overview(page);
  await page.goto('/office?view=play');
  await overview(page); // Source skips the splash and leaves the existing overview camera.
  await reachable(page.getByRole('button', { name: 'Enter first person', exact: true }));
  await page.getByRole('button', { name: 'Enter first person', exact: true }).click();
  await ready(page);
  await expect(gate).toHaveCount(0);
});

test('integrated Play, WASD/E, HUD/map, 3D, tours and baked remain reachable', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const bakedAssets: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.url().includes('/office-art/') && response.url().endsWith('.glb') && response.ok()) bakedAssets.push(response.url()); });
  await page.goto('/office?view=overview');
  await overview(page);
  const view = page.getByLabel('Office view');
  await view.selectOption('plan');
  await expect(page.getByLabel('2D office floor plan')).toBeVisible();
  await chrome(page);
  await capture(page, 'floor-plan');
  await view.selectOption('walk');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await view.selectOption('tween');
  await overview(page);
  await view.selectOption('play');
  await expect(page.getByTestId('play-splash')).toHaveCount(0); // View changes enter directly in the source.
  await ready(page);
  await page.evaluate(() => document.exitPointerLock?.());
  await chrome(page);
  await expect(page.locator('.office-shell')).toHaveAttribute('data-hud', 'diegetic');
  await expect(page.locator('.play-crosshair')).toBeVisible();
  if (testInfo.project.name === 'mobile') await expect(page.locator('.play-joystick')).toBeVisible();
  await expect(page.locator('[data-lobby-audit-board]')).toHaveAttribute('data-lobby-audit-board', 'shown');
  expect(bakedAssets).toEqual([]);
  await capture(page, 'first-person');
  await surface(page).focus();
  for (const key of ['w', 's', 'a', 'd']) {
    const before = await surface(page).evaluate(el => ({ x: Number((el as HTMLElement).dataset.playerX), z: Number((el as HTMLElement).dataset.playerZ) }));
    await page.keyboard.down(key);
    try {
      await page.waitForFunction(start => {
        const el = document.querySelector<HTMLElement>('[data-player-x][data-player-z]');
        return el && Math.hypot(Number(el.dataset.playerX) - start.x, Number(el.dataset.playerZ) - start.z) > 0.04;
      }, before, { polling: 'raf', timeout: 8_000 });
    } finally { await page.keyboard.up(key); }
  }
  const mapToggle = page.locator('.play-minimap-toggle');
  const wasShown = await mapToggle.getAttribute('aria-pressed');
  expect(['true', 'false']).toContain(wasShown);
  await surface(page).focus();
  await page.keyboard.press('m');
  await expect(mapToggle).toHaveAttribute('aria-pressed', wasShown === 'true' ? 'false' : 'true');
  await page.keyboard.press('m');
  await expect(mapToggle).toHaveAttribute('aria-pressed', wasShown!);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Play settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Close Play settings' }).click();
  await expect(surface(page)).toBeFocused();
  // Full map is an explicit Play tool; the replacement HUD must never take over Rooms.
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.overview-map')).toBeVisible();
  await capture(page, 'play-map');
  await page.getByRole('button', { name: 'Close overview', exact: true }).click();
  const roomsEntry = page.locator('.play-overview');
  await reachable(roomsEntry);
  await roomsEntry.click();
  await overview(page);
  await expect(view).toHaveValue('tween');
  await page.getByRole('navigation', { name: 'Office shortcuts' }).getByRole('button', { name: 'Rooms', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Rooms', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await view.selectOption('tour');
  await expect(view).toHaveValue('tour');
  await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Stop tour', exact: true }).click();
  await overview(page);
  const storyButton = page.getByRole('button', { name: /^Story mode$/i });
  await reachable(storyButton);
  await storyButton.click();
  const story = page.getByRole('complementary', { name: 'Judge story mode' });
  await expect(story).toBeVisible();
  await expect(page.getByTestId('story-camera')).toHaveAttribute('data-story-anchor', 'lobby');
  await story.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByTestId('story-camera')).toHaveAttribute('data-story-anchor', 'collections');
  await capture(page, 'judge-tour');
  await story.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(story).toHaveCount(0);
  await expect(surface(page)).toBeFocused();
  await page.evaluate(() => document.exitPointerLock?.());
  await page.keyboard.press('Escape');
  await overview(page);
  await page.goto('/office?demo=story');
  await expect(story).toBeVisible();
  await expect(page.getByTestId('play-splash')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(story).toHaveCount(0);
  await expect(surface(page)).toBeFocused();
  await page.goto('/office?view=overview&playSpawn=-7,4.75');
  await view.selectOption('play');
  await ready(page);
  await expect(page.locator('.play-prompt')).toHaveText('E · Pick up folder');
  await surface(page).focus();
  await page.keyboard.press('e');
  await expect(page.getByTestId('office-carry-folder')).toHaveText('Held invoice folder');
  await capture(page, 'folder-interaction');
  await page.goto('/office?art=baked&view=overview');
  await view.selectOption('play');
  await ready(page);
  await expect(page.locator('[data-lobby-audit-board]')).toHaveAttribute('data-lobby-audit-board', 'baked');
  await expect.poll(() => bakedAssets.some(url => url.endsWith('/office-art/lobby.glb'))).toBe(true);
  await page.evaluate(() => document.exitPointerLock?.());
  await chrome(page);
  await capture(page, 'baked-opt-in');
  await page.getByRole('button', { name: 'Exit Play', exact: true }).click();
  await overview(page);
  // Reach a real Play interaction, then hand off to the single Audit Wall question field.
  // Keep this after the tour/baked checks so a handoff regression does not mask them.
  await view.selectOption('play');
  await ready(page);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const map = page.getByRole('region', { name: 'Office overview', exact: true });
  await map.getByRole('button', { name: /^Alex,.*Go here or talk$/ }).click();
  await page.getByRole('menu', { name: /Alex/ }).getByRole('menuitem', { name: /^Go here/ }).click();
  await expect(map).toHaveCount(0);
  await expect(page.locator('.play-prompt')).toHaveText('E · Talk to Alex');
  await surface(page).focus();
  await page.keyboard.press('e');
  const talking = page.getByRole('dialog', { name: 'Talking with Alex', exact: true });
  await talking.getByRole('button', { name: 'Ask why', exact: true }).click();
  await expect(surface(page)).toHaveCount(0);
  await expect(talking).toHaveCount(0);
  const audit = page.getByRole('dialog', { name: 'Audit Wall', exact: true });
  await expect(audit).toBeVisible();
  await expect(page.locator('[data-office-mount="ask-why"]')).toHaveCount(1);
  const question = audit.getByRole('textbox', { name: 'Question', exact: true });
  await expect(question).toBeFocused();
  await reachable(question);
  await expect(question).not.toHaveValue('');
  await capture(page, 'ask-why-after-play');
  await audit.getByRole('button', { name: 'Close Audit Wall', exact: true }).click();
  await expect(audit).toHaveCount(0);
  await overview(page);
  expect(errors).toEqual([]);
});
