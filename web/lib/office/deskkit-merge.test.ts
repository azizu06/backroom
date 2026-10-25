import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferAttribute, Color, Group, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { buildDeskKitBatch } from './deskkit-merge';
import { DESKKIT_TINT_MATERIAL, type KitPlacement } from './deskkit';

function material(name: string, color = 0x808080, roughness = 0.55, metalness = 0) {
  const m = new MeshStandardMaterial({ color, roughness, metalness, vertexColors: true });
  m.name = name;
  return m;
}
function part(geometryMaterial: MeshStandardMaterial, x = 0) {
  const geometry = new BoxGeometry(1, 1, 1);
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(0.5), 3));
  const mesh = new Mesh(geometry, geometryMaterial);
  mesh.position.x = x;
  return mesh;
}

const wood = material('wood', 0xc08040, 0.55), trim = material('trim', 0xffffff, 0.5);
const metal = material('metal', 0x808080, 0.35, 0.2), tint = material(DESKKIT_TINT_MATERIAL, 0x336699, 0.9);
function kit(): Map<string, Object3D> {
  const desk = new Group(); desk.name = 'desk'; desk.add(part(wood), part(metal, 0.5), part(trim, 1));
  const chair = new Group(); chair.name = 'chair'; chair.add(part(metal), part(tint));
  return new Map<string, Object3D>([['desk', desk], ['chair', chair]]);
}
const at = (id: string, node: KitPlacement['node'], x: number, extra: Partial<KitPlacement> = {}): KitPlacement =>
  ({ id, node, room: 'collections', source: 'desk', at: [x, 0, 0], rotationY: 0, ...extra });

describe('desk kit batching', () => {
  it('draws one mesh per surface finish however many placements there are', () => {
    const placements = [0, 1, 2, 3, 4, 5].flatMap(i => [at(`d${i}`, 'desk', i * 3), at(`c${i}`, 'chair', i * 3, { tint: '#ff0000' })]);
    const batch = buildDeskKitBatch(kit(), placements);
    // Wood and trim differ only in colour and nearly in roughness, so they share a draw call; metal and tint do not.
    expect(batch.meshes.map(mesh => mesh.name).sort()).toEqual(['deskkit:metal', 'deskkit:tint', 'deskkit:trim+wood']);
    const vertices = new BoxGeometry(1, 1, 1).getAttribute('position').count;
    const metalMesh = batch.meshes.find(mesh => mesh.name === 'deskkit:metal')!;
    // Desk and chair both use metal: 6 desks + 6 chairs merged into one geometry.
    expect(metalMesh.geometry.getAttribute('position').count).toBe(12 * vertices);
    const drawn = metalMesh.material as MeshStandardMaterial;
    expect(drawn).not.toBe(metal);
    expect([drawn.color.getHex(), drawn.metalness, drawn.roughness, drawn.vertexColors]).toEqual([0xffffff, 0.2, 0.35, true]);
    const shared = batch.meshes.find(mesh => mesh.name === 'deskkit:trim+wood')!;
    expect((shared.material as MeshStandardMaterial).roughness).toBeCloseTo(0.525);
    batch.dispose();
  });

  it('bakes each material colour into the vertex colours', () => {
    const batch = buildDeskKitBatch(kit(), [at('d', 'desk', 0)]);
    const shared = batch.meshes.find(mesh => mesh.name === 'deskkit:trim+wood')!.geometry.getAttribute('color');
    expect(shared.getX(0)).toBeCloseTo(0.5 * wood.color.r);
    expect(shared.getX(shared.count - 1)).toBeCloseTo(0.5 * trim.color.r);
    batch.dispose();
  });

  it('bakes placement transforms into world space', () => {
    const batch = buildDeskKitBatch(kit(), [at('c', 'chair', 10, { rotationY: Math.PI / 2, scale: [2, 1, 1] })]);
    const seat = batch.meshes.find(mesh => mesh.name === 'deskkit:tint')!;
    seat.geometry.computeBoundingBox();
    const box = seat.geometry.boundingBox!;
    // A 1 m cube scaled 2 m along x then turned a quarter: 1 m along x, 2 m along z, centred on the placement.
    expect(box.max.x - box.min.x).toBeCloseTo(1);
    expect(box.max.z - box.min.z).toBeCloseTo(2);
    expect((box.max.x + box.min.x) / 2).toBeCloseTo(10);
    batch.dispose();
  });

  it('recolours tint placements through vertex colours on a white copy of the tint material', () => {
    const batch = buildDeskKitBatch(kit(), [at('a', 'chair', 0, { tint: '#ff0000' }), at('b', 'chair', 3)]);
    const tinted = batch.meshes.find(mesh => mesh.name === 'deskkit:tint')!;
    const drawn = tinted.material as MeshStandardMaterial;
    expect(drawn).not.toBe(tint);
    expect(drawn.color.getHex()).toBe(0xffffff);
    expect(drawn.vertexColors).toBe(true);
    const color = tinted.geometry.getAttribute('color');
    const red = new Color('#ff0000'), base = tint.color;
    expect(color.getX(0)).toBeCloseTo(0.5 * red.r);
    expect(color.getY(0)).toBeCloseTo(0.5 * red.g);
    const last = color.count - 1; // The untinted chair keeps the material's own colour.
    expect(color.getX(last)).toBeCloseTo(0.5 * base.r);
    expect(color.getZ(last)).toBeCloseTo(0.5 * base.b);
    batch.dispose();
  });

  it('owns only the merged geometry and copied materials, never the kit templates', () => {
    const templates = kit();
    const batch = buildDeskKitBatch(templates, [at('c', 'chair', 0, { tint: '#00ff00' })]);
    const disposed: string[] = [];
    batch.meshes.forEach(mesh => mesh.geometry.addEventListener('dispose', () => disposed.push(mesh.name)));
    const copy = batch.meshes.find(mesh => mesh.name === 'deskkit:tint')!.material as MeshStandardMaterial;
    let copyDisposed = false, sharedDisposed = false;
    copy.addEventListener('dispose', () => { copyDisposed = true; });
    metal.addEventListener('dispose', () => { sharedDisposed = true; });
    batch.dispose();
    expect(disposed.sort()).toEqual(['deskkit:metal', 'deskkit:tint']);
    expect(batch.meshes.every(mesh => mesh.material !== metal && mesh.material !== tint)).toBe(true);
    expect(copyDisposed).toBe(true);
    expect(sharedDisposed).toBe(false);
  });

  it('refuses a placement whose node the kit lacks', () => {
    expect(() => buildDeskKitBatch(kit(), [at('m', 'monitor', 0)])).toThrow(/monitor/);
  });
});
