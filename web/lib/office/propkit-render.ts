import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Euler, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3, type Object3D, type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette';
import { PROPKIT_NODES, PROPKIT_SPECS, type PropKitNode, type PropPlacement } from './propkit';

export interface PropKitBatch { meshes: InstancedMesh[]; dispose(): void }
interface Template { geometry: BufferGeometry; material: MeshBasicMaterial }

/** Static matrices: one submission per named node, regardless of placement count. Batch owns its inputs. */
function instanceTemplates(templates: Map<PropKitNode, Template>, placements: readonly PropPlacement[]): PropKitBatch {
  const meshes: InstancedMesh[] = [];
  for (const [node, template] of templates) {
    const instances = placements.filter(p => p.node === node);
    if (!instances.length) continue;
    const mesh = new InstancedMesh(template.geometry, template.material, instances.length);
    mesh.name = `propkit:${node}`;
    mesh.castShadow = false; mesh.receiveShadow = false;
    instances.forEach((p, index) => mesh.setMatrixAt(index, new Matrix4().compose(
      new Vector3(...p.position), new Quaternion().setFromEuler(new Euler(0, p.rotation, 0)),
      new Vector3(...(p.scale ?? [1, 1, 1])),
    )));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    meshes.push(mesh);
  }
  return { meshes, dispose() {
    meshes.forEach(mesh => mesh.dispose());
    new Set([...templates.values()].map(t => t.geometry)).forEach(g => g.dispose());
    new Set([...templates.values()].map(t => t.material)).forEach(m => m.dispose());
  } };
}

/** A partial / untextured kit is a failure: never hide even part of the procedural fallback. */
export function buildPropKitBatch(scene: Object3D, placements: readonly PropPlacement[]): PropKitBatch {
  scene.updateMatrixWorld(true);
  const templates = new Map<PropKitNode, Template>();
  const materials = new Map<Texture, MeshBasicMaterial>();
  try {
    for (const node of PROPKIT_NODES) {
      const source = scene.getObjectByName(node);
      if (!(source instanceof Mesh) || Array.isArray(source.material) ||
          !source.geometry.getAttribute('uv') || !source.geometry.getAttribute('position')?.count)
        throw new Error(`Prop kit is missing a textured mesh: ${node}`);
      const map = (source.material as { map?: Texture }).map;
      if (!map) throw new Error(`Prop kit is missing its lightmap: ${node}`);
      if (materials.size && !materials.has(map)) throw new Error('Prop kit must share one lightmap');
      let material = materials.get(map);
      if (!material) {
        // The atlas already contains albedo + lighting. No second lighting or tone-mapping pass.
        material = new MeshBasicMaterial({ map, toneMapped: false });
        material.name = 'propkit_lightmap'; materials.set(map, material);
      }
      const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
      templates.set(node, { geometry, material });
      geometry.computeBoundingBox();
      const bounds = geometry.boundingBox!;
      const [w, h, d] = PROPKIT_SPECS[node].size;
      if (bounds.min.x < -w / 2 - 0.025 || bounds.max.x > w / 2 + 0.025 ||
          bounds.min.z < -d / 2 - 0.025 || bounds.max.z > d / 2 + 0.025 ||
          bounds.min.y < -0.025 || bounds.max.y > h + 0.025)
        throw new Error(`Prop kit exceeds its placement envelope: ${node}`);
    }
    return instanceTemplates(templates, placements);
  } catch (error) {
    templates.forEach(t => t.geometry.dispose());
    materials.forEach(m => m.dispose());
    throw error;
  }
}

/** Recognisable procedural stand-ins, with the same floor envelopes as the bake and static colliders. */
export function buildPropKitFallback(placements: readonly PropPlacement[]): PropKitBatch {
  const templates = new Map<PropKitNode, Template>();
  const material = new MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  for (const node of PROPKIT_NODES) {
    const [w, h, d] = PROPKIT_SPECS[node].size;
    const parts: BufferGeometry[] = [];
    const part = (shape: BufferGeometry, color: string, x: number, y: number, z: number) => {
      const g = shape.toNonIndexed(); shape.dispose();
      g.translate(x, y, z);
      const c = new Color(color), colors = new Float32Array(g.getAttribute('position').count * 3);
      for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
      g.setAttribute('color', new BufferAttribute(colors, 3)); parts.push(g);
    };
    const box = (color: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) =>
      part(new BoxGeometry(sx, sy, sz), color, x, y, z);
    if (node.startsWith('plant_')) {
      part(new CylinderGeometry(w * 0.34, w * 0.26, h * 0.35, 12), PALETTE.peach, 0, h * 0.175, 0);
      const foliage = new SphereGeometry(1, 12, 8); foliage.scale(w / 2, h * 0.325, d / 2);
      part(foliage, PALETTE.mint, 0, h * 0.675, 0);
    } else if (node === 'floor_lamp' || node === 'pendant_lamp') {
      const hanging = node === 'pendant_lamp';
      part(new CylinderGeometry(w / 2, w * 0.3, 0.32, 16), PALETTE.butter, 0, hanging ? 0.16 : h - 0.16, 0);
      box(PALETTE.slate, 0, h / 2, 0, 0.035, h, 0.035);
      if (!hanging) part(new CylinderGeometry(w * 0.4, w / 2, 0.05, 16), PALETTE.navy, 0, 0.025, 0);
    } else if (node === 'bookshelf') {
      box(PALETTE.peach, 0, h / 2, -d / 2 + 0.03, w, h, 0.06);
      for (const side of [-1, 1]) box(PALETTE.peach, side * (w / 2 - 0.03), h / 2, 0, 0.06, h, d);
      for (let row = 0; row < 4; row++) {
        box(PALETTE.peach, 0, 0.03 + row * 0.55, 0, w, 0.06, d);
        if (row < 3) for (let book = 0; book < 5; book++)
          box([PALETTE.aqua, PALETTE.blush, PALETTE.lavender][book % 3]!, -0.36 + book * 0.17,
            0.23 + row * 0.55, 0, 0.12, 0.34, d * 0.8);
      }
    } else if (node === 'water_cooler') {
      box(PALETTE.cream, 0, 0.5, 0, w, 1, d);
      part(new CylinderGeometry(0.21, 0.18, 0.5, 12), PALETTE.aqua, 0, 1.25, 0);
      box(PALETTE.navy, 0, 0.7, d / 2, 0.22, 0.2, 0.001);
    } else if (node === 'coffee_station') {
      box(PALETTE.peach, 0, 0.45, 0, w, 0.9, d);
      box(PALETTE.navy, 0, 1.175, 0, 0.55, 0.55, 0.4);
      box(PALETTE.aqua, 0, 1.3, 0.205, 0.36, 0.12, 0.01);
      box(PALETTE.cream, 0, 1, 0.23, 0.15, 0.13, 0.1);
    } else if (node === 'arcade') {
      box(PALETTE.lavender, 0, h / 2, 0, w, h, d);
      box(PALETTE.navy, 0, 1.18, d / 2, w * 0.8, 0.65, 0.001);
      box(PALETTE.aqua, 0, 1.22, d / 2 + 0.001, w * 0.6, 0.4, 0.001);
      box(PALETTE.butter, 0, 1.62, d / 2, w * 0.8, 0.12, 0.001);
    } else {
      box(node === 'rug_large' ? PALETTE.blush : PALETTE.navy, 0, h / 2, 0, w, h, d);
      if (node !== 'rug_large') box(node === 'office_tv' ? PALETTE.aqua : PALETTE.butter,
        0, h / 2, d / 2, w * 0.85, h * 0.8, 0.001);
    }
    const geometry = mergeGeometries(parts);
    parts.forEach(p => p.dispose());
    if (!geometry) throw new Error(`Cannot merge fallback ${node}`);
    templates.set(node, { geometry, material });
  }
  return instanceTemplates(templates, placements);
}

/** The loader owns source geometry, materials and the single embedded texture, even on late cancellation. */
export function disposePropKitSource(scene: Object3D): void {
  const textures = new Set<Texture>();
  scene.traverse(node => {
    if (!(node instanceof Mesh)) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      const map = (material as { map?: Texture }).map;
      if (map) textures.add(map);
      material.dispose();
    }
  });
  textures.forEach(texture => texture.dispose());
}
