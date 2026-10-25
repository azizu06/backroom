import { test, expect, type Page } from '@playwright/test';
import { openMenu, openSheet } from './office-menu';

// /office uses AJ’s sidebar + topbar shell; the 3D scene fills the main pane, not the whole window.
const BANNED = /\b(demo|synthetic|fake|sandbox|simulated|simulation|preview|hackathon)\b/i;
const visibleText = (page: Page) => page.locator('.office-shell').evaluate(element => (element as HTMLElement).innerText);

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test('the shell keeps a sidebar and topbar beside a measured 3D viewport', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('/office?view=overview');
      await openMenu(page);

      const canvas = page.getByTestId('office-viewport').locator('canvas');
      await expect(canvas).toBeVisible();
      await expect(page.getByTestId('office-viewport').getByText('Loading 3D office…')).toHaveCount(0);
      await expect.poll(() => canvas.boundingBox().then(box => box && box.width > 200 && box.height > 200), { timeout: 15_000 }).toBe(true);

      await expect(page.getByRole('complementary', { name: 'Office navigation' })).toBeVisible();
      await expect(page.getByTestId('office-topbar')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Backroom menu' })).toHaveCount(0);
      await expect(page.locator('.office-corner')).toHaveCount(0);

      for (const name of ['Full Floor', 'Rooms', 'Audit Wall', 'Help']) {
        await expect(page.getByRole('complementary', { name: 'Office navigation' }).getByRole('button', { name, exact: true })).toBeVisible();
      }
      await expect(page.getByRole('button', { name: 'Play (First Person)', exact: true })).toBeVisible();
      await expect(page.getByLabel('Office view')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sound off', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Full Screen', exact: true })).toBeVisible();
      expect(await visibleText(page)).not.toMatch(BANNED);

      await openSheet(page, 'overview');
      await expect(page.getByRole('heading', { name: 'Today at Backroom' })).toBeVisible();
      expect(await visibleText(page)).not.toMatch(BANNED);
      await page.getByRole('button', { name: 'Close Today at Backroom' }).click();
      await expect(page.getByRole('dialog', { name: 'Today at Backroom' })).toHaveCount(0);

      await openSheet(page, 'help');
      await expect(page.getByRole('heading', { name: 'Things to Try' })).toBeVisible();
      await expect(page.getByText('Test the Treasury Lock')).toBeVisible();
      await page.getByRole('button', { name: 'Close Help' }).click();
      expect(errors).toEqual([]);
    });
  });
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    test.describe(`quiet sheets at ${viewport.width}x${viewport.height}, motion ${reducedMotion}`, () => {
      test.use({ viewport, reducedMotion });

      test('Help anchors focus uncovered headings within the sheet and preserve search and Escape', async ({ page }) => {
        await page.goto('/office?view=overview');
        await openMenu(page);
        const opener = page.getByRole('complementary', { name: 'Office navigation' }).getByRole('button', { name: 'Help', exact: true });
        await opener.click();
        const dialog = page.getByRole('dialog', { name: 'Help', exact: true });
        await expect(dialog).toBeVisible({ timeout: 200 });
        await expect(dialog.getByRole('button', { name: 'Close Help' })).toBeFocused();
        // Include content and icon animations: a stagger must not extend the entrance beyond 200 ms.
        const timings = await dialog.evaluate(element => element.getAnimations({ subtree: true })
          .map(animation => Number(animation.effect!.getComputedTiming().endTime)));
        if (reducedMotion === 'reduce') expect(timings).toEqual([]);
        else {
          expect(timings.length).toBeGreaterThan(0);
          for (const end of timings) expect(end).toBeLessThanOrEqual(180);
          await expect(dialog).toHaveCSS('animation-timing-function', 'ease-out');
        }
        await expect(dialog).toHaveCSS('opacity', '1', { timeout: 200 });
        await expect(dialog.locator('.detail-sheet-body')).toHaveCSS('opacity', '1', { timeout: 200 });
        await page.keyboard.press('Tab');
        await expect(dialog.getByRole('searchbox', { name: 'Search help' })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(dialog.getByRole('button', { name: 'Getting Around', exact: true })).toBeFocused();
        const pageScroll = await page.evaluate(() => window.scrollY);
        const anchors = dialog.getByRole('navigation', { name: 'Help sections' });
        // Go down and back up, including the last section where scrolling is clamped at the bottom.
        for (const [label, heading] of [
          ['Glossary', 'Glossary'], ['Shortcuts', 'Keyboard Shortcuts'], ['Flows', 'How Things Flow'],
          ['Things to Try', 'Things to Try'], ['Getting Around', 'Getting Around'],
        ]) {
          const button = anchors.getByRole('button', { name: label, exact: true });
          if (label === 'Glossary') await button.click();
          else {
            await button.focus();
            await page.keyboard.press('Enter');
          }
          const target = dialog.getByRole('heading', { name: heading, exact: true });
          await expect(target).toBeFocused();
          const [targetBox, headerBox, navigationBox, sheetBox] = await Promise.all([
            target.boundingBox(), dialog.locator('.detail-sheet-header').boundingBox(),
            dialog.locator('.help-navigation').boundingBox(), dialog.boundingBox(),
          ]);
          expect(targetBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height);
          expect(targetBox!.y).toBeGreaterThanOrEqual(navigationBox!.y + navigationBox!.height);
          expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(sheetBox!.y + sheetBox!.height);
          expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
        }
        await dialog.getByRole('searchbox', { name: 'Search help' }).fill('zzzz-no-match');
        await expect(dialog.getByRole('status')).toContainText('Nothing matches');
        for (const button of await anchors.getByRole('button').all()) await expect(button).toBeDisabled();
        await dialog.getByRole('searchbox', { name: 'Search help' }).fill('');
        await expect(anchors.getByRole('button', { name: 'Glossary', exact: true })).toBeEnabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0, { timeout: 200 });
        await expect(opener).toBeFocused();
      });

      test('Play Settings groups remember keyboard disclosure choices and Reset remains outside them', async ({ page }) => {
        const enterPlay = async () => {
          await page.goto('/office?view=overview');
          await openMenu(page);
          await expect(page.getByLabel('Office view')).toBeEnabled();
          await expect(page.getByTestId('office-viewport').locator('canvas')).toBeVisible();
          await page.getByRole('button', { name: 'Play (First Person)', exact: true }).click();
          await expect(page.getByRole('application', { name: /First-person office/ }))
            .toHaveAttribute('data-player-fov', /\d/, { timeout: 30_000 });
          // Both layouts render Settings; entering Play can hide it while the pointer is locked.
          await page.evaluate(() => document.exitPointerLock?.());
          await expect(page.getByTestId('office-viewport')).not.toHaveAttribute('data-pointer-locked');
          await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
          await page.getByRole('button', { name: 'Settings', exact: true }).focus();
          await page.keyboard.press('Enter');
        };
        await enterPlay();
        const dialog = page.getByRole('dialog', { name: 'Play Settings', exact: true });
        const controls = dialog.locator('details').filter({ has: page.locator('summary', { hasText: /^Controls$/ }) });
        const feel = dialog.locator('details').filter({ has: page.locator('summary', { hasText: 'Movement Feel' }) });
        await expect(controls).toHaveAttribute('open', '');
        await expect(feel).not.toHaveAttribute('open');
        await expect(dialog.getByRole('slider', { name: 'Look sensitivity' })).toBeFocused();
        await expect(feel.getByText(reducedMotion === 'reduce'
          ? 'Reduced motion is on in your system, so these are off'
          : 'Motion applies while walking.', { exact: true })).toBeVisible();
        await expect(feel.getByRole('checkbox', { name: 'Head bob' })).toBeHidden();
        for (const name of ['Look sensitivity', 'Movement speed']) {
          await dialog.getByRole('slider', { name }).focus();
          await page.keyboard.press('ArrowRight');
          await page.keyboard.press('ArrowRight');
        }
        await dialog.getByRole('checkbox', { name: 'Invert Y (look)' }).check();
        await feel.locator('summary').focus();
        await page.keyboard.press('Enter');
        await expect(feel).toHaveAttribute('open', '');
        if (reducedMotion === 'reduce') {
          for (const name of ['Smooth movement', 'Head bob', 'Field-of-view kick']) {
            await expect(dialog.getByRole('checkbox', { name, exact: true })).toBeDisabled();
          }
          await dialog.getByRole('switch', { name: 'Use motion anyway' }).check();
        }
        for (const name of ['Smooth movement', 'Head bob', 'Field-of-view kick']) {
          await dialog.getByRole('checkbox', { name, exact: true }).uncheck();
        }
        await controls.locator('summary').focus();
        await page.keyboard.press('Space');
        await expect(controls).toHaveJSProperty('open', false);
        // Native toggle events and the persistence effect run after the DOM changes.
        // Wait for the saved choices before unmounting the dialog and reloading.
        await expect.poll(() => page.evaluate(() =>
          JSON.parse(localStorage.getItem('backroom.office.play-settings-groups.v1') ?? 'null')
        )).toEqual({ controls: false, feel: true });
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0, { timeout: 200 });
        // A fresh page proves the disclosure preferences and input values survive remounts.
        await enterPlay();
        await expect(controls).not.toHaveAttribute('open');
        await expect(feel).toHaveAttribute('open', '');
        await expect(controls.locator('summary')).toBeFocused();
        for (const name of ['Smooth movement', 'Head bob', 'Field-of-view kick']) {
          await expect(dialog.getByRole('checkbox', { name, exact: true })).not.toBeChecked();
        }
        await controls.locator('summary').click();
        await expect(dialog.getByRole('slider', { name: 'Look sensitivity' })).toHaveValue('1.5');
        await expect(dialog.getByRole('slider', { name: 'Movement speed' })).toHaveValue('1.5');
        await expect(dialog.getByRole('checkbox', { name: 'Invert Y (look)' })).toBeChecked();
        await controls.locator('summary').click();
        await feel.locator('summary').click();
        await expect(dialog.getByText('Saved in this browser only.')).toBeVisible();
        await dialog.getByRole('button', { name: 'Reset to defaults' }).click();
        await expect(controls).not.toHaveAttribute('open');
        await expect(feel).not.toHaveAttribute('open');
        await controls.locator('summary').click();
        await feel.locator('summary').click();
        await expect(dialog.getByRole('slider', { name: 'Look sensitivity' })).toHaveValue('1');
        await expect(dialog.getByRole('slider', { name: 'Movement speed' })).toHaveValue('1');
        await expect(dialog.getByRole('checkbox', { name: 'Invert Y (look)' })).not.toBeChecked();
        for (const name of ['Smooth movement', 'Head bob', 'Field-of-view kick']) {
          await expect(dialog.getByRole('checkbox', { name, exact: true })).toBeChecked();
        }
      });
    });
  }
}
