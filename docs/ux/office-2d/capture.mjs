/** Capture the existing office UI. Requires a running build and installed Chromium. */
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const viewports = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};
export const surfaces = [
  'splash', 'shell', 'navigation', 'topbar', 'view-menu', 'state', 'viewers',
  'llm', 'theme', 'info', 'info-details', 'full-floor', 'rooms', 'details',
  'inbox', 'audit', 'ask-why', 'calls', 'payment-link', 'controller', 'policy',
  'attack', 'operator', 'system-status', 'help', 'shortcuts', 'floor-plan',
  'play-hud', 'minimap', 'play-settings', 'office-panels', 'overview-map',
  'overview-menu', 'operator-hud', 'overview-return', 'exit-play', 'story', 'fullscreen',
];

// Executed in the browser; independent of application internals and business state.
export function measureElement(element) {
  const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
  const metrics = node => ({
    scrollHeight: node.scrollHeight, clientHeight: node.clientHeight,
    screens: node.clientHeight ? node.scrollHeight / node.clientHeight : null,
    scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
    horizontalScreens: node.clientWidth ? node.scrollWidth / node.clientWidth : null,
  });
  const descendants = [...element.querySelectorAll('*')];
  return {
    ...metrics(element),
    sections: descendants.filter(node => node.matches('section') && visible(node)).length,
    headings: descendants.filter(node => node.matches('h1,h2,h3,h4,h5,h6,[role=heading]') && visible(node)).length,
    nestedScrollers: descendants.filter(node => visible(node) && /auto|scroll/.test(getComputedStyle(node).overflowY)
      && node.scrollHeight > node.clientHeight + 1).map(node => ({ selector: node.tagName.toLowerCase() + (node.className ? `.${String(node.className).trim().split(/\s+/).join('.')}` : ''), ...metrics(node) })),
  };
}

export function validateCapture(report) {
  const problems = [];
  for (const viewport of Object.keys(viewports)) for (const surface of surfaces) {
    const row = report.captures?.[viewport]?.[surface];
    if (!row || row.status !== 'captured') { problems.push(`${viewport}/${surface}: missing capture`); continue; }
    const hiddenMinimap = surface === 'minimap' && row.visibility === 'hidden' && row.clientHeight === 0
      && row.scrollHeight === 0 && row.screens === null && !!row.note;
    if (!hiddenMinimap && (!(row.clientHeight > 0) || row.scrollHeight < row.clientHeight || !Number.isFinite(row.screens)
      || Math.abs(row.screens - row.scrollHeight / row.clientHeight) > 0.000001)) problems.push(`${viewport}/${surface}: invalid dimensions`);
    if (![row.sections, row.headings].every(value => Number.isInteger(value) && value >= 0)) problems.push(`${viewport}/${surface}: invalid counts`);
    if (row.image !== `${surface}-${viewport}.png`) problems.push(`${viewport}/${surface}: unexpected image`);
  }
  return problems;
}

export function finalizeCapture(report) {
  const problems = validateCapture(report);
  report.errors.push(...problems);
  // Completion describes inventory coverage; preserve any earlier errors as evidence.
  report.complete = problems.length === 0;
}

export async function runCapture() {
  // Resolve through web's declared dependency; ESM does not use NODE_PATH.
  const requireWeb = createRequire(new URL('../../../web/package.json', import.meta.url));
  const { chromium } = requireWeb('@playwright/test');
  const base = new URL(process.env.BASE_URL || 'http://localhost:3200');
  const output = new URL('./', import.meta.url);
  await mkdir(output, { recursive: true });
  const report = { baseURL: base.href, startedAt: new Date().toISOString(), viewports, captures: {}, errors: [], complete: false,
    conditions: 'Fresh unauthenticated contexts; existing backend state, no submitted forms or model calls. Mobile splash forced with view=play.' };
  let browser;
  // Stop the entire run before two minutes, including launch; preserve a partial report on failure.
  const deadline = setTimeout(() => {
    report.errors.push('Capture exceeded 110 seconds');
    void writeFile(new URL('measurements.json', output), JSON.stringify(report, null, 2)).finally(() => process.exit(1));
  }, 110_000);
  try {
    browser = await chromium.launch({ headless: true, timeout: 10_000 });
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'light',
        hasTouch: viewportName === 'mobile', isMobile: viewportName === 'mobile' });
      const page = await context.newPage();
      page.setDefaultTimeout(3000);
      page.setDefaultNavigationTimeout(12_000);
      report.captures[viewportName] = {};
      const button = (root, name) => root.getByRole('button', { name, exact: typeof name === 'string' });
      const navigation = page.getByRole('complementary', { name: 'Office navigation' });
      const dialog = name => page.getByRole('dialog', { name, exact: typeof name === 'string' });
      const releasePointer = () => page.evaluate(() => document.exitPointerLock?.());
      const captureSurface = async (id, root, note = '') => {
        // The current Play stylesheet intentionally hides the minimap. Capture absence honestly.
        await root.waitFor({ state: id === 'minimap' ? 'attached' : 'visible' });
        const visibility = await root.isVisible() ? 'visible' : 'hidden';
        if (id !== 'ask-why') await root.evaluate(node => { node.scrollTop = 0; });
        // Let the existing 500ms icon/sheet animations finish; do not alter product CSS.
        await page.waitForTimeout(550);
        const measured = await root.evaluate(measureElement);
        const image = `${id}-${viewportName}.png`;
        await page.screenshot({ path: fileURLToPath(new URL(image, output)), fullPage: false, timeout: 5000 });
        report.captures[viewportName][id] = { status: 'captured', image, ...measured, visibility, note,
          url: page.url(), connection: await page.locator('.office-shell').getAttribute('data-connection') };
        if (['office-panels', 'help'].includes(id) && measured.screens > 1.05) {
          await root.evaluate(node => { node.scrollTop = node.scrollHeight; });
          await page.screenshot({ path: fileURLToPath(new URL(`${id}-${viewportName}-bottom.png`, output)), fullPage: false, timeout: 5000 });
          await root.evaluate(node => { node.scrollTop = 0; });
        }
      };
      const openSheet = async (name, title) => {
        await button(navigation, name).click();
        const root = dialog(title);
        await root.waitFor({ state: 'visible' });
        return root;
      };
      const closeSheet = root => root.getByRole('button', { name: /^Close / }).first().click();
      const enterPlay = async () => {
        await button(page, 'Play (First Person)').click();
        await page.getByRole('application', { name: /First-person office/ }).waitFor();
        await releasePointer();
      };

      await page.goto(new URL('/office?view=play', base).href, { waitUntil: 'domcontentloaded' });
      await dialog('Backroom').waitFor({ timeout: 12_000 });
      await captureSurface('splash', dialog('Backroom'), viewportName === 'mobile' ? 'Forced first-visit splash; phone default skips this gate.' : 'First visit.');
      await button(dialog('Backroom'), 'Overview (map view)').click();
      await page.getByTestId('office-viewport').locator('canvas').waitFor({ timeout: 12_000 });
      await page.getByText('Loading 3D office…', { exact: true }).waitFor({ state: 'hidden', timeout: 12_000 });
      await captureSurface('shell', page.locator('.office-shell'));
      await captureSurface('navigation', navigation, 'Phone navigation scrolls horizontally; vertical screens alone understate reach.');
      await captureSurface('topbar', page.getByTestId('office-topbar'));
      await page.getByLabel('Office view', { exact: true }).focus();
      await captureSurface('view-menu', page.getByLabel('Office view', { exact: true }), 'Native select captured focused/closed: OS popup is not reliably present in page screenshots.');
      report.captures[viewportName]['view-menu'].options = await page.locator('#office-view option').allTextContents();
      for (const [id, selector] of [['state', '.connection-status'], ['viewers', '.presence-toggle'], ['llm', '.llm-control'], ['theme', '.theme-toggle'], ['info', '.real-sim-tile']]) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        await captureSurface(id, page.locator(selector), 'Existing control; no business-state toggle performed.');
      }
      await button(page.getByRole('complementary', { name: 'System Status', exact: true }), 'Details').click();
      await captureSurface('info-details', page.locator('.real-sim-tile-body'));
      await button(page.getByRole('complementary', { name: 'System Status', exact: true }), 'Details').click();

      for (const [id, name, title] of [
        ['full-floor', 'Full Floor', 'Today at Backroom'], ['rooms', 'Rooms', 'Rooms'],
        ['inbox', /^Inbox/, /^Inbox/], ['audit', 'Audit Wall', 'Audit Wall'], ['help', 'Help', 'Help'],
      ]) {
        const root = await openSheet(name, title);
        await captureSurface(id, root);
        if (id === 'audit') {
          const question = root.getByRole('textbox', { name: 'Question', exact: true });
          await question.scrollIntoViewIfNeeded();
          await question.focus();
          // Measure the enclosing sheet, because the Ask why section shares its scroller.
          await captureSurface('ask-why', root, 'Shared Audit Wall scroller; question focused, no request submitted.');
        }
        if (id === 'rooms') {
          await root.getByRole('button', { name: /^Collections/ }).click();
          await captureSurface('details', dialog('Collections'));
          await closeSheet(dialog('Collections'));
        } else await closeSheet(root);
      }
      for (const [id, group, tab] of [
        ['calls', /^Calls/, 'Calls'], ['payment-link', /^Calls/, 'Payment Link'],
        ['controller', 'Approvals', 'Controller'], ['policy', 'Approvals', 'Policy'],
        ['attack', 'Attack Lab', null], ['operator', 'Setup', 'Operator'], ['system-status', 'Setup', 'System Status'],
      ]) {
        const title = id === 'calls' || id === 'payment-link' ? 'Calls' : group;
        const root = await openSheet(group, title);
        if (tab) await root.getByRole('tab', { name: tab === 'Payment Link' ? /^Payment Link/ : tab, exact: tab !== 'Payment Link' }).click();
        await root.locator('.sheet-tab-panel > main, .sheet-tab-panel > .attack-panel, .sheet-tab-panel > .real-sim-page, .sheet-tab-panel > .page-lede').first().waitFor({ state: 'attached' });
        await captureSurface(id, root, 'Initial unauthenticated/empty state; populated or authorized state may be longer.');
        await closeSheet(root);
      }
      await page.getByLabel('Office view', { exact: true }).blur();
      await page.keyboard.press('?');
      await captureSurface('shortcuts', dialog('Keyboard Shortcuts'));
      await button(dialog('Keyboard Shortcuts'), 'Close').click();
      await page.getByLabel('Office view', { exact: true }).selectOption('plan');
      await captureSurface('floor-plan', page.getByLabel('2D office floor plan', { exact: true }));
      await enterPlay();
      await captureSurface('play-hud', page.locator('.play-hud'));
      await captureSurface('minimap', page.locator('.play-minimap-wrap'), 'Current diegetic Play CSS hides this wrapper. Screenshot records its absence; zero dimensions and null screens are intentional if hidden.');
      // Overview can intercept pointer clicks here. Keyboard activation reaches Settings
      // without concealing the product bug by changing CSS or clicking the overlay.
      await button(page, 'Settings').focus();
      await button(page, 'Settings').press('Enter');
      await captureSurface('play-settings', dialog('Play Settings'));
      await button(page, 'Close Play settings').click();
      await button(page, /^Office panels/).click();
      await captureSurface('office-panels', page.locator('#office-drawer'));
      await button(page, 'Close office panels').click();
      await button(page, 'Map').click();
      const map = page.getByRole('region', { name: 'Office Overview', exact: true });
      await captureSurface('overview-map', map);
      await map.getByRole('button', { name: /^Collections/ }).click();
      await captureSurface('overview-menu', page.getByRole('menu'));
      await page.keyboard.press('Escape');
      await button(page, 'Close overview').click();
      await page.locator('.play-hud').getByRole('link', { name: 'Operator', exact: true }).click();
      if (new URL(page.url()).pathname !== '/office') throw new Error('Operator HUD link left the office');
      await dialog('Setup').locator('.sheet-tab-panel > main').waitFor({ state: 'attached' });
      await captureSurface('operator-hud', dialog('Setup'), 'Checks actual delegated link behavior; expects Setup sheet without a page hop.');
      await closeSheet(dialog('Setup'));
      await enterPlay();
      await button(page.locator('.play-hud'), 'Overview').click();
      await captureSurface('overview-return', page.locator('.office-shell'), 'Overview action returns to overhead camera; distinct from Map region.');
      await enterPlay();
      await button(page, 'Exit Play').click();
      await captureSurface('exit-play', page.locator('.office-shell'), 'Result of Exit Play; compare with Overview return.');
      await button(page, 'Story Mode').click();
      const story = page.getByRole('complementary', { name: 'Judge story mode' });
      await button(story, 'Pause').click();
      await captureSurface('story', story, 'First chapter, paused.');
      await button(story, 'Skip').click();
      await button(page, 'Full Screen').click();
      await captureSurface('fullscreen', page.getByRole('group', { name: 'Full screen status' }), 'Alternate camera selector; normal toolbar hidden.');
      await context.close();
    }
  } catch (error) {
    report.errors.push(String(error));
  } finally {
    finalizeCapture(report);
    report.finishedAt = new Date().toISOString();
    await writeFile(new URL('measurements.json', output), `${JSON.stringify(report, null, 2)}\n`);
    if (browser) await browser.close();
    clearTimeout(deadline);
  }
  if (!report.complete) throw new Error(`Incomplete capture: ${report.errors.join('; ')}`);
  console.log(`Captured ${surfaces.length * Object.keys(viewports).length} surfaces; measurements.json is complete.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCapture();
