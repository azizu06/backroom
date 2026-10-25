import { test, expect, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { currentOfficeWalk } from './helpers/office-walk';
import { frameHasGeometry, type WalkSpot } from '../lib/office/office-walk';
import { TURN_SPEED, type Box, type Vec2 } from '../lib/office/play';
import { GAMEPAD_DEADZONE } from '../lib/office/gamepad';

// Opt in with pnpm run test:office:walk; build the server with NEXT_PUBLIC_OFFICE_TEST=1.
test.skip(process.env.OFFICE_WALK !== '1', 'Run with test:office:walk to enable the walkthrough');

interface WalkDebug { position: [number, number]; yaw: number; eye: [number, number, number]; colliders: Box[]; radius: number }
declare global { interface Window { readonly __officeWalk?: WalkDebug; __officeWalkPad: { axes: number[] } } }
interface Result { spot: string; viewport: string; position: readonly number[] | null; pass: boolean; reason: string; screenshot?: string }

/** Feed the existing gamepad adapter and HUD turn keys; all positions come from the real Play rig. */
async function drive(page: Page, path: readonly Vec2[], yaw: number) {
  await page.evaluate(async ({ path, yaw, turnStep, deadzone }) => {
    const surface = document.querySelector<HTMLElement>('[data-player-x]');
    if (!surface || !window.__officeWalk) throw new Error('Missing first-person test getter; build with NEXT_PUBLIC_OFFICE_TEST=1');
    surface.focus();
    const key = (type: 'keydown' | 'keyup', value: string) => surface.dispatchEvent(new KeyboardEvent(type, { key: value, bubbles: true }));
    const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
    const turn = (desired: number, actual: number) => {
      const taps = Math.round(wrap(desired - actual) / turnStep), name = taps > 0 ? 'ArrowLeft' : 'ArrowRight';
      for (let i = 0; i < Math.abs(taps); i++) { key('keydown', name); key('keyup', name); }
    };
    const started = performance.now();
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const read = () => {
      const state = window.__officeWalk!;
      const [x, , z] = state.eye;
      if (state.colliders.some(b => x > b.minX - state.radius && x < b.maxX + state.radius
        && z > b.minZ - state.radius && z < b.maxZ + state.radius)) throw new Error(`Camera intersects collider at ${x},${z}`);
      if (performance.now() - started > 15000) throw new Error(`Route leg timed out at ${state.position}`);
      return state;
    };
    const settle = async () => { await frame(); read(); await frame(); read(); };
    const face = async (desired: number) => {
      while (Math.abs(wrap(desired - read().yaw)) > turnStep * 0.6) {
        const before = read().yaw;
        turn(desired, before);
        // A demand-rendered scene can skip RAFs. Observe consumption instead of queuing the turn twice.
        do { await frame(); } while (Math.abs(wrap(read().yaw - before)) < 0.000001);
      }
      key('keyup', 'w');
      await settle(); // Let the turn reach the camera before capturing.
    };
    const axes = window.__officeWalkPad.axes;
    const axis = (value: number) => value === 0 ? 0 : Math.sign(value) * (deadzone + Math.min(1, Math.abs(value)) * (1 - deadzone));
    try {
      for (const goal of path) {
        let previous = read().position, lastProgress = performance.now();
        while (true) {
          const state = read(), dx = goal[0] - state.position[0], dz = goal[1] - state.position[1];
          if (Math.hypot(dx, dz) <= 0.035) {
            axes[0] = axes[1] = 0;
            // Wait for the pad's release to reach the rig before accepting an arrival.
            let stable = 0, stopped = state.position;
            while (stable < 2) {
              await frame(); const next = read().position;
              stable = Math.hypot(next[0] - stopped[0], next[1] - stopped[1]) < 0.00001 ? stable + 1 : 0;
              stopped = next;
            }
            if (Math.hypot(goal[0] - stopped[0], goal[1] - stopped[1]) <= 0.065) break;
            previous = stopped; lastProgress = performance.now(); continue;
          }
          if (Math.hypot(state.position[0] - previous[0], state.position[1] - previous[1]) > 0.0001) lastProgress = performance.now();
          if (performance.now() - lastProgress > 750) throw new Error(`Blocked step towards ${goal} at ${state.position}`);
          previous = state.position;
          // World delta -> local stick axes. Slow down near the waypoint; 1.2 m leaves room for
          // two maximum-delta frames at the configured 6 m/s, including the pad polling latency.
          const scale = Math.max(1.2, Math.hypot(dx, dz));
          axes[0] = axis((Math.cos(state.yaw) * dx - Math.sin(state.yaw) * dz) / scale);
          axes[1] = axis((Math.sin(state.yaw) * dx + Math.cos(state.yaw) * dz) / scale);
          await frame();
        }
        axes[0] = axes[1] = 0; await settle();
      }
      await face(yaw);
    } finally { axes[0] = axes[1] = 0; key('keyup', 'w'); }

  }, { path, yaw, turnStep: TURN_SPEED / 60, deadzone: GAMEPAD_DEADZONE });
}

async function capture(page: Page, path: string) {
  const png = await page.getByTestId('office-viewport').locator('canvas').first().screenshot({ path,
    // Hide HTML overlays so HUD text cannot make a solid WebGL frame pass the pixel check.
    style: '[data-testid="office-viewport"] * { visibility: hidden !important } [data-testid="office-viewport"] canvas { visibility: visible !important }',
  });
  const pixels = await page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0, 96, 96);
    return Array.from(context.getImageData(0, 0, 96, 96).data);
  }, png.toString('base64'));
  expect(frameHasGeometry(pixels), `Full-screen single-colour frame: ${path}`).toBe(true);
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000, hasTouch: false, isMobile: false },
  { name: 'mobile', width: 390, height: 844, hasTouch: true, isMobile: true },
]) test.describe(viewport.name, () => {
  test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.hasTouch,
    isMobile: viewport.isMobile, reducedMotion: 'reduce' });
  test('walks every layout destination without clipping', async ({ page }, testInfo) => {
    test.setTimeout(180000); // The script caps both viewports together at four minutes.
    let walk = currentOfficeWalk();
    let directory = `/tmp/backrooms-walk/${walk.hash}`;
    let results: Result[] = [];
    let spot: WalkSpot | undefined;
    const save = async () => {
      await mkdir(directory, { recursive: true });
      let other: Result[] = [];
      try { other = JSON.parse(await readFile(`${directory}/results.json`, 'utf8')) as Result[]; } catch { /* first viewport */ }
      await writeFile(`${directory}/results.json`, JSON.stringify([...other.filter(r => r.viewport !== viewport.name), ...results], null, 2));
    };
    try {
      // Prevent external assets/telemetry from making this local QA run depend on the network.
      await page.route('**/*', route => new URL(route.request().url()).hostname === 'localhost' ? route.continue() : route.abort());
      await page.addInitScript(() => {
        localStorage.setItem('backroom.office.play-settings.v1', JSON.stringify({ speed: 2,
          smoothMove: false, headBob: false, fovKick: false }));
        const pad = { id: 'Office walkthrough pad', index: 0, connected: true, mapping: 'standard', timestamp: 0,
          axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
        window.__officeWalkPad = pad;
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad] });
      });
      await page.goto('/office?view=overview');
      await expect(async () => {
        await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
        await expect(page.locator('[data-player-x]')).toBeVisible({ timeout: 1000 });
      }).toPass({ timeout: 20000 });
      await expect.poll(() => page.evaluate(() => !!window.__officeWalk), {
        message: 'Build the office server with NEXT_PUBLIC_OFFICE_TEST=1 to expose the read-only collider getter', timeout: 5000,
      }).toBe(true);
      const debug = await page.evaluate(() => window.__officeWalk!);
      walk = currentOfficeWalk(debug.colliders); directory = `/tmp/backrooms-walk/${walk.hash}`;
      await save();
      for (const stop of walk.stops) {
        spot = stop.spot;
        await drive(page, stop.path, spot.yaw);
        const state = await page.evaluate(() => window.__officeWalk!);
        expect(Math.hypot(state.position[0] - spot.position[0], state.position[1] - spot.position[1]), spot.id).toBeLessThanOrEqual(0.07);
        expect(state.eye[1]).toBeCloseTo(spot.eye[1], 2);
        const screenshot = `${directory}/${viewport.name}-${spot.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
        await capture(page, screenshot);
        results.push({ spot: spot.id, viewport: viewport.name, position: state.eye, pass: true, reason: 'Pose reached; collision and pixel checks passed', screenshot });
        await save();
      }
    } catch (error) {
      const state = await page.evaluate(() => window.__officeWalk).catch(() => undefined);
      results.push({ spot: spot?.id ?? 'setup', viewport: viewport.name, position: state?.eye ?? null, pass: false, reason: String(error) });
      await save(); throw error;
    } finally {
      console.log(`Office walk results: ${directory}/results.json`);
      await testInfo.attach('office-walk-results', { path: `${directory}/results.json`, contentType: 'application/json' });
    }
  });
});
