import { test, expect } from '@playwright/test';
import { CHAIR_FOOTPRINT } from '../lib/office/metrics';
import type { SeatProbeCanvas } from '../app/office/avatars/AvatarAnchors';

// Planner: pnpm exec playwright test --config playwright.office.config.ts tests/office-agent-seated.spec.ts
for (const art of ['', '&art=baked']) {
  test(`agents occupy their existing chair footprints${art || ' (procedural)'}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`/office?view=overview&seatProbe=1${art}`);
    const canvas = page.getByTestId('office-viewport').locator('canvas');
    await expect(canvas).toBeVisible();
    const sample = () => canvas.evaluate(element => (element as SeatProbeCanvas).officeSeatBounds?.() ?? []);
    await expect.poll(async () => (await sample()).filter(row => row.blend === 1).length).toBeGreaterThanOrEqual(7);
    const agents = (await sample()).filter(row => row.blend === 1);
    for (const { name, bounds, seat } of agents) {
      expect(bounds.minX, name).toBeLessThan(seat.x + CHAIR_FOOTPRINT.width / 2);
      expect(bounds.maxX, name).toBeGreaterThan(seat.x - CHAIR_FOOTPRINT.width / 2);
      expect(bounds.minZ, name).toBeLessThan(seat.z + CHAIR_FOOTPRINT.depth / 2);
      expect(bounds.maxZ, name).toBeGreaterThan(seat.z - CHAIR_FOOTPRINT.depth / 2);
      expect(bounds.maxY, `${name}: plate clears the head`).toBeLessThan(1.95);
    }
    expect(errors).toEqual([]);
  });
}
