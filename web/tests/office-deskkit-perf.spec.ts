import { test, expect, type Page } from '@playwright/test';

// Run via test:office:browser after building the web app. Needs WebGL for the first-person Play view.
// Runtime budget for the opt-in desk kit (?art=baked): turning in Play with the kit loaded must cost about the same
// draw calls and frame CPU as the same build with the kit missing (procedural props), measured in the same page setup.
const DRAW_CALL_BUDGET = 1.15;
const FRAME_CPU_BUDGET = 1.5; // Headless frame CPU is noisy; draw calls are the strict gate.
const KIT_WARNING = 'Desk kit /office-art/deskkit.glb failed to load; using the procedural props.';

function surface(page: Page) {
  return page.getByRole('application', { name: /First-person office/ });
}

interface Sample { calls: number; ms: number }

/** Opens baked art with the perf overlay, waits for the kit (or its fallback), then turns a full circle in Play. */
async function measure(page: Page, kit: boolean): Promise<Sample> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const onError = (error: Error) => errors.push(error.message);
  const onConsole = (message: { type(): string; text(): string }) => { if (message.type() === 'warning') warnings.push(message.text()); };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  await page.unrouteAll();
  if (!kit) await page.route('**/office-art/deskkit.glb', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/office?view=overview&art=baked&perf=1'); // Skip the Enter splash, as office-play.spec.ts does.
  const available = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  });
  if (!available) throw new Error('WebGL is unavailable in this headless Chromium, so the first-person Play view cannot render.');
  const viewport = page.getByTestId('office-viewport');
  await expect(viewport.locator('canvas')).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  if (kit) await expect(viewport.locator('canvas[data-deskkit="ready"]')).toHaveCount(1, { timeout: 30_000 });
  else await expect.poll(() => warnings.some(text => text.startsWith(KIT_WARNING))).toBe(true);
  const select = page.getByLabel('Office view');
  await expect(select).toHaveValue('walk');
  await select.selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/, { timeout: 15_000 });
  await expect(page.getByTestId('office-perf-calls')).toHaveText(/^\d+$/);
  await page.keyboard.down('ArrowRight');
  let sample: Sample;
  try {
    sample = await page.evaluate(() => new Promise<Sample>(resolve => {
      const calls = document.querySelector('[data-testid="office-perf-calls"]')!;
      const ms = document.querySelector('[data-testid="office-perf"] dl > div:last-child span')!;
      const started = performance.now();
      let max = 0;
      const tick = () => {
        max = Math.max(max, Number(calls.textContent));
        if (performance.now() - started < 4000) requestAnimationFrame(tick);
        else resolve({ calls: max, ms: Number(ms.textContent) });
      };
      requestAnimationFrame(tick);
    }));
  } finally {
    await page.keyboard.up('ArrowRight');
  }
  page.off('pageerror', onError);
  page.off('console', onConsole);
  expect(errors).toEqual([]);
  return sample;
}

test('the loaded desk kit stays within the procedural draw-call and frame budget while turning in Play', async ({ page }) => {
  test.setTimeout(120_000);
  const baseline = await measure(page, false);
  const kit = await measure(page, true);
  console.log(`deskkit perf: procedural ${baseline.calls} calls / ${baseline.ms} ms; kit ${kit.calls} calls / ${kit.ms} ms`);
  expect(baseline.calls).toBeGreaterThan(0);
  expect(kit.calls).toBeLessThanOrEqual(Math.ceil(baseline.calls * DRAW_CALL_BUDGET));
  expect(kit.ms).toBeLessThanOrEqual(Math.max(baseline.ms * FRAME_CPU_BUDGET, baseline.ms + 4));
});
