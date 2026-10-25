import { test, expect } from '@playwright/test';

const WARNING = 'Desk kit /office-art/deskkit.glb failed to load; using the procedural props.';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return host === 'localhost' || host === '127.0.0.1' ? route.continue() : route.abort();
  });
});

test('without the baked flag the office never requests or activates the kit', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/deskkit.glb')) requests.push(request.url()); });
  await page.goto('/office?view=overview');
  const canvas = page.getByTestId('office-viewport').locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByText('Loading 3D office…')).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute('data-deskkit', 'ready');
  expect(requests).toEqual([]);
});

test('the kit stays unready until the delayed asset is available', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/office-art/deskkit.glb', async route => {
    requested = true;
    await gate;
    await route.continue();
  });
  try {
    await page.goto('/office?view=overview&art=baked');
    const canvas = page.getByTestId('office-viewport').locator('canvas');
    await expect(canvas).toBeVisible();
    await expect.poll(() => requested).toBe(true);
    await expect(canvas).not.toHaveAttribute('data-deskkit', 'ready');
    release();
    await expect(canvas).toHaveAttribute('data-deskkit', 'ready', { timeout: 30_000 });
  } finally { release(); }
});

test('a missing kit retains the procedural fallback without page errors', async ({ page }) => {
  const warnings: string[] = [], errors: string[] = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/office-art/deskkit.glb', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/office?view=overview&art=baked');
  await expect.poll(() => warnings.some(warning => warning.startsWith(WARNING))).toBe(true);
  const canvas = page.getByTestId('office-viewport').locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).not.toHaveAttribute('data-deskkit', 'ready');
  expect(errors).toEqual([]);
});
