import { test, expect, type Page } from '@playwright/test';
import { HALL_NODES } from '../lib/office/baked-art';
import { wallColliders } from '../lib/office/layout';

// A tiny real GLB exercises loading/commit/fallback without requiring a GX10 bake in the browser test.
// This fixture is deliberately not an art/screenshot fixture.
function hallFixture(): Buffer {
  const positions = Buffer.from(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer);
  const json = JSON.stringify({ asset: { version: '2.0' }, scene: 0,
    scenes: [{ nodes: HALL_NODES.map((_, i) => i) }],
    nodes: HALL_NODES.map(name => ({ name, ...(name === 'walls' ? {} : { mesh: 0 }) })),
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: positions.length, uri: `data:application/octet-stream;base64,${positions.toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteLength: positions.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
  });
  const body = Buffer.from(json.padEnd(Math.ceil(Buffer.byteLength(json) / 4) * 4, ' '));
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + body.length, 8);
  header.writeUInt32LE(body.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, body]);
}

async function openBaked(page: Page) {
  const warnings: string[] = [], errors: string[] = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/office?art=baked&view=overview');
  const canvas = page.getByTestId('office-viewport').locator('canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('office-viewport').getByText('Loading 3D office…')).toHaveCount(0);
  return { warnings, errors, canvas };
}

async function enterPlay(page: Page) {
  await openMenu(page);
  await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
  const surface = page.getByRole('application', { name: /First-person office/ });
  await expect(surface).toBeFocused();
  await expect(surface).toHaveAttribute('data-player-z', /\d/);
}

test('a missing hall keeps the procedural room and loads exterior only in Play', async ({ page }) => {
  let exteriorRequests = 0;
  await page.route('**/office-art/hall.glb', route => route.fulfill({ status: 404, body: 'missing' }));
  await page.route('**/office-art/exterior.glb', route => { exteriorRequests++; return route.fulfill({ status: 404, body: 'missing' }); });
  const { warnings, errors, canvas } = await openBaked(page);
  await expect.poll(() => warnings.some(text => text.startsWith('Baked art /office-art/hall.glb failed'))).toBe(true);
  await expect(canvas).toHaveAttribute('data-baked-hall', 'fallback');
  expect(exteriorRequests).toBe(0);
  await enterPlay(page);
  await expect.poll(() => exteriorRequests).toBe(1);
  await expect(canvas).toHaveAttribute('data-baked-hall', 'fallback');
  await expect(page.locator('[data-lobby-audit-board]')).toHaveAttribute('data-lobby-audit-board', 'shown');
  expect(errors).toEqual([]);
});

test('hall becomes ready only after its matching colliders load; exterior failure leaves it ready', async ({ page }) => {
  await page.route('**/office-art/hall.glb', route => route.fulfill({ contentType: 'model/gltf-binary', body: hallFixture() }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/office-art/hall.colliders.json', async route => {
    await gate;
    await route.fulfill({ json: { room: 'hall', boxes: wallColliders() } });
  });
  await page.route('**/office-art/exterior.glb', route => route.fulfill({ status: 404, body: 'missing' }));
  const { warnings, errors, canvas } = await openBaked(page);
  await expect(canvas).toHaveAttribute('data-baked-hall', 'fallback');
  release();
  await expect(canvas).toHaveAttribute('data-baked-hall', 'ready');
  await enterPlay(page);
  await expect.poll(() => warnings.some(text => text.startsWith('Baked art /office-art/exterior.glb failed'))).toBe(true);
  await expect(canvas).toHaveAttribute('data-baked-hall', 'ready');
  expect(errors).toEqual([]);
});

test('stale colliders reject an otherwise loadable hall', async ({ page }) => {
  await page.route('**/office-art/hall.glb', route => route.fulfill({ contentType: 'model/gltf-binary', body: hallFixture() }));
  await page.route('**/office-art/hall.colliders.json', route => route.fulfill({ json: { room: 'hall', boxes: [] } }));
  const { warnings, errors, canvas } = await openBaked(page);
  await expect.poll(() => warnings.some(text => text.startsWith('Baked art /office-art/hall.glb failed'))).toBe(true);
  await expect(canvas).toHaveAttribute('data-baked-hall', 'fallback');
  expect(errors).toEqual([]);
});
