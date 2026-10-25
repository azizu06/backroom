import { test, expect } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  test(`offline recording plays from start to finish at ${viewport.width}px`, async ({ page }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    const api: string[] = [], errors: string[] = [];
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) api.push(`${request.method()} ${request.url()}`); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/office?replay=core-offline');
    const controls = page.getByLabel('Replay controls');
    await controls.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('canvas')).toBeVisible();
    await controls.getByRole('combobox', { name: 'Speed', exact: true }).selectOption('8');
    const slider = page.getByRole('slider', { name: 'Replay position' });
    await slider.evaluate(element => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, '0');
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(slider).toHaveValue('0');
    const end = await slider.getAttribute('max');
    expect(Number(end)).toBeGreaterThan(0);
    await controls.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(slider).toHaveValue(end!, { timeout: 30_000 });
    await expect(controls.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    await expect(page.getByText(/Recorded chain verified/)).toBeVisible();
    await page.screenshot({ path: info.outputPath('recording-finished.png'), fullPage: true });
    await controls.getByRole('link', { name: 'Full audit wall', exact: true }).click();
    await expect(page).toHaveURL(/\/audit\?replay=core-offline/);
    await expect(page.getByLabel('Operator code')).toHaveCount(0);
    await expect(page.getByText(/Recorded chain verified/)).toBeVisible();
    expect(api).toEqual([]);
    expect(errors).toEqual([]);
  });
}
