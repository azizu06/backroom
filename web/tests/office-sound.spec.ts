import { test, expect } from '@playwright/test';

test('office sound is opt-in and remembers its label without starting audio on reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    let creations = 0;
    Object.defineProperty(window, '__officeAudioContexts', { get: () => creations });
    if (window.AudioContext) window.AudioContext = new Proxy(window.AudioContext, {
      construct(target, args) { creations++; return Reflect.construct(target, args); },
    });
  });
  const contexts = () => page.evaluate(() => Number(Reflect.get(window, '__officeAudioContexts')));

  await page.goto('/office');
  const off = page.getByRole('button', { name: 'Sound off', exact: true });
  await expect(off).toBeEnabled();
  await expect(off).toHaveAttribute('aria-pressed', 'false');
  expect(await contexts()).toBe(0);
  await off.click();
  const on = page.getByRole('button', { name: 'Sound on', exact: true });
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('office.sound'))).toBe('on');
  expect(await contexts()).toBe(1);

  await page.reload();
  await expect(on).toBeEnabled();
  await expect(on).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('office.sound'))).toBe('on');
  expect(await contexts()).toBe(0);
  await on.click();
  await expect(off).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('office.sound'))).toBe('off');
  expect(await contexts()).toBe(0);
  expect(errors).toEqual([]);
});
