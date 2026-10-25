import { test, expect, type Page } from '@playwright/test';
import { openMenu } from './office-menu';
import { deflateSync } from 'node:zlib';
import { PROPKIT_NODES, PROPKIT_SPECS, currentPropKitLayout, propkitPlacements } from '../lib/office/propkit';

// Production build + WebGL required. Uses a tiny in-memory glTF fixture until the Phase B bake is available.
const WARNING = 'Baked art /office-art/lobby.glb failed to load; using the procedural scene.';
const PROPKIT_WARNING = 'Prop kit /office-art/propkit.glb failed to load; using the procedural props.';

function surface(page: Page) {
  return page.getByRole('application', { name: /First-person office/ });
}

async function openBaked(page: Page, search = '?art=baked&view=overview') {
  const warnings: string[] = [], errors: string[] = [];
  page.on('console', message => { if (message.type() === 'warning') warnings.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  // These are local rendering checks, never integration calls or remote asset downloads.
  await page.route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return host === 'localhost' || host === '127.0.0.1' ? route.fallback() : route.abort();
  });
  await page.goto(`/office${search}`);
  const available = await page.evaluate(() => !!document.createElement('canvas').getContext('webgl2'));
  if (!available) throw new Error('WebGL is unavailable in this Chromium; the first-person office cannot render.');
  const viewport = page.getByTestId('office-viewport');
  await expect(viewport.locator('canvas')).toBeVisible();
  await expect(viewport.getByText('Loading 3D office…')).toHaveCount(0);
  await page.getByRole('button', { name: 'Full Floor', exact: true }).click();
  await page.getByRole('button', { name: 'Preview Treasury denial' }).click();
  await page.getByRole('button', { name: 'Close Today at Backroom' }).click();
  await expect(page.getByTestId('lobby-deny-stamp')).toContainText('DENIED · NOT_IN_BADGE');
  return { warnings, errors, canvas: viewport.locator('canvas') };
}

async function enterPlay(page: Page) {
  await openMenu(page);
  await page.getByLabel('Office view').selectOption({ label: 'Play (first person)' });
  await expect(surface(page)).toBeFocused();
  await expect(surface(page)).toHaveAttribute('data-player-z', /\d/, { timeout: 15_000 });
}

test('a missing desk kit keeps the procedural audit board and stamp in Play', async ({ page }) => {
  await page.route('**/office-art/deskkit.glb', route => route.fulfill({ status: 404, body: 'missing' }));
  const { warnings, errors } = await openBaked(page);
  await expect.poll(() => warnings.some(text => text.startsWith(WARNING))).toBe(true);
  await enterPlay(page);
  const board = page.locator('[data-lobby-audit-board]');
  await expect(board).toHaveAttribute('data-lobby-audit-board', 'shown');
  await expect(page.getByTestId('lobby-deny-stamp')).toContainText('DENIED · NOT_IN_BADGE');
  // Still procedural after a beat: nothing flips once the load has already failed.
  await page.waitForTimeout(500);
  await expect(board).toHaveAttribute('data-lobby-audit-board', 'shown');
  expect(errors).toEqual([]);
});

test('a loaded desk kit retains the procedural audit board and stamp in the open office', async ({ page }) => {
  // Main retired the incompatible baked lobby shell; the kit must not bring it back.
  const lobbyRequests: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/office-art/lobby.glb')) lobbyRequests.push(request.url()); });
  const { warnings, errors } = await openBaked(page);
  await expect(page.getByTestId('office-viewport').locator('canvas')).toHaveAttribute('data-deskkit', 'ready', { timeout: 30_000 });
  await enterPlay(page);
  await expect(page.locator('[data-lobby-audit-board]')).toHaveAttribute('data-lobby-audit-board', 'shown');
  await expect(page.getByTestId('lobby-deny-stamp')).toContainText('DENIED · NOT_IN_BADGE');
  expect(lobbyRequests).toEqual([]);
  expect(warnings.filter(text => text.startsWith('Desk kit'))).toEqual([]);
  expect(errors).toEqual([]);
});

/** One white PNG texel; built locally so the success fixture has no external image dependency. */
function whitePixel(): string {
  const chunk = (name: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

function kitFixture(complete = true): string {
  const positions = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]);
  const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
  const buffer = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(uvs.buffer)]);
  const nodes = (complete ? PROPKIT_NODES : PROPKIT_NODES.filter(n => n !== 'arcade'))
    .map(name => ({ name, mesh: 0, scale: [...PROPKIT_SPECS[name].size] }));
  return JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes,
    buffers: [{ byteLength: buffer.length, uri: `data:application/octet-stream;base64,${buffer.toString('base64')}` }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: uvs.byteLength }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    textures: [{ source: 0 }], images: [{ uri: `data:image/png;base64,${whitePixel()}` }],
  });
}

test('a missing kit keeps visible procedural props and a usable Play route', async ({ page }) => {
  await page.route('**/office-art/propkit.glb', route => route.fulfill({ status: 404, body: 'missing' }));
  const { warnings, errors, canvas } = await openBaked(page);
  await expect.poll(() => warnings.some(text => text.startsWith(PROPKIT_WARNING))).toBe(true);
  await expect(canvas).toHaveAttribute('data-propkit', 'fallback');
  await expect(canvas).toHaveAttribute('data-propkit-instances', String(propkitPlacements(currentPropKitLayout()).length));
  await enterPlay(page);
  const startX = Number(await surface(page).getAttribute('data-player-x'));
  await page.keyboard.down('d');
  await expect.poll(async () => Number(await surface(page).getAttribute('data-player-x'))).toBeGreaterThan(startX + 0.4);
  await page.keyboard.up('d');
  await expect(canvas).toHaveAttribute('data-propkit', 'fallback');
  expect(errors).toEqual([]);
});

test('only a complete textured kit replaces the procedural set', async ({ page }) => {
  await page.route('**/office-art/propkit.glb', route => route.fulfill({ contentType: 'model/gltf+json', body: kitFixture() }));
  const { warnings, errors, canvas } = await openBaked(page);
  await expect(canvas).toHaveAttribute('data-propkit', 'ready');
  await expect(canvas).toHaveAttribute('data-propkit-instances', String(propkitPlacements(currentPropKitLayout()).length));
  await enterPlay(page);
  await expect(canvas).toHaveAttribute('data-propkit', 'ready');
  expect(warnings.filter(text => text.startsWith('Prop kit'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('a partial kit leaves the entire procedural set visible', async ({ page }) => {
  await page.route('**/office-art/propkit.glb', route => route.fulfill({ contentType: 'model/gltf+json', body: kitFixture(false) }));
  const { warnings, errors, canvas } = await openBaked(page);
  await expect.poll(() => warnings.some(text => text.startsWith(PROPKIT_WARNING))).toBe(true);
  await expect(canvas).toHaveAttribute('data-propkit', 'fallback');
  expect(errors).toEqual([]);
});

test('the default office never requests or mounts the prop kit', async ({ page }) => {
  let requests = 0;
  await page.route('**/office-art/propkit.glb', route => { requests++; return route.abort(); });
  const { errors, canvas } = await openBaked(page, '?view=overview');
  await enterPlay(page);
  await expect(canvas).not.toHaveAttribute('data-propkit');
  expect(requests).toBe(0);
  expect(errors).toEqual([]);
});
