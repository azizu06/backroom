import { describe, expect, it, vi } from 'vitest';
import { Box3, BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three';
import { buildPropKitBatch, buildPropKitFallback, disposePropKitSource } from './propkit-render';
import { currentPropKitLayout, PROPKIT_NODES, PROPKIT_SPECS, propkitPlacements, propPlacementFootprint } from './propkit';
import { markContactDynamic } from '../../app/office/ContactShadows';
import { CONTACT_DYNAMIC_LAYER } from './lighting';

function fixture() {
  const scene = new Group(), map = new Texture();
  for (const node of PROPKIT_NODES) {
    const [w, h, d] = PROPKIT_SPECS[node].size;
    const mesh = new Mesh(new BoxGeometry(w, h, d).translate(0, h / 2, 0), new MeshStandardMaterial({ map }));
    mesh.name = node; scene.add(mesh);
  }
  return scene;
}
const placements = propkitPlacements(currentPropKitLayout());

describe('prop kit visual / collision contract', () => {
  it('keeps every fallback visible at the collision footprint until the entire kit is valid', () => {
    const fallback = buildPropKitFallback(placements);
    for (const mesh of fallback.meshes) {
      const node = mesh.name.slice('propkit:'.length) as keyof typeof PROPKIT_SPECS;
      const instances = placements.filter(p => p.node === node);
      mesh.geometry.computeBoundingBox();
      instances.forEach((p, i) => {
        const matrix = new Matrix4(); mesh.getMatrixAt(i, matrix);
        const bounds = mesh.geometry.boundingBox!.clone().applyMatrix4(matrix);
        const footprint = propPlacementFootprint(p);
        expect(bounds.min.x, p.id).toBeCloseTo(footprint.minX, 2);
        expect(bounds.max.x, p.id).toBeCloseTo(footprint.maxX, 2);
        expect(bounds.min.z, p.id).toBeCloseTo(footprint.minZ, 2);
        expect(bounds.max.z, p.id).toBeCloseTo(footprint.maxZ, 2);
        expect(bounds.max.y, p.id).toBeGreaterThan(p.position[1]);
      });
    }
    fallback.dispose();
  });

  it('uses one instanced, unlit draw per node and no shadow passes', () => {
    const scene = fixture(), batch = buildPropKitBatch(scene, placements);
    expect(batch.meshes).toHaveLength(PROPKIT_NODES.length);
    expect(batch.meshes.reduce((n, m) => n + m.count, 0)).toBe(placements.length);
    const materials = new Set(batch.meshes.map(m => m.material));
    expect(materials.size).toBe(1);
    const root = new Group(); root.add(...batch.meshes);
    markContactDynamic(root);
    expect(root.layers.isEnabled(CONTACT_DYNAMIC_LAYER)).toBe(true); // excluded from static contact bake
    for (const mesh of batch.meshes) {
      expect(mesh.castShadow).toBe(false); expect(mesh.receiveShadow).toBe(false);
      expect(mesh.layers.isEnabled(CONTACT_DYNAMIC_LAYER)).toBe(false); // also excluded from the dynamic pass
      expect(mesh.material).toMatchObject({ type: 'MeshBasicMaterial', toneMapped: false });
    }
    const geometryDispose = vi.spyOn(batch.meshes[0]!.geometry, 'dispose');
    batch.dispose(); expect(geometryDispose).toHaveBeenCalledOnce();
    disposePropKitSource(scene);
  });

  it('rejects missing nodes, missing maps, separate maps and oversized geometry', () => {
    const incomplete = fixture(); incomplete.remove(incomplete.getObjectByName('arcade')!);
    expect(() => buildPropKitBatch(incomplete, placements)).toThrow(/arcade/); disposePropKitSource(incomplete);
    const noMap = fixture(); (noMap.children[0] as Mesh).material = new MeshStandardMaterial();
    expect(() => buildPropKitBatch(noMap, placements)).toThrow(/lightmap/); disposePropKitSource(noMap);
    const separate = fixture(); (separate.children[0] as Mesh).material = new MeshStandardMaterial({ map: new Texture() });
    expect(() => buildPropKitBatch(separate, placements)).toThrow(/one lightmap/); disposePropKitSource(separate);
    const oversized = fixture(); oversized.children[0]!.scale.setScalar(2);
    expect(() => buildPropKitBatch(oversized, placements)).toThrow(/envelope/); disposePropKitSource(oversized);
  });

  it('applies loaded node transforms once and preserves instance rotations', () => {
    const scene = fixture(), mesh = scene.children[0] as Mesh;
    mesh.geometry.rotateX(Math.PI / 2); mesh.rotation.x = -Math.PI / 2;
    const batch = buildPropKitBatch(scene, placements);
    expect(new Box3().setFromObject(batch.meshes[0]!).getSize(new Vector3()).y).toBeCloseTo(1.65);
    batch.dispose(); disposePropKitSource(scene);
  });
});
