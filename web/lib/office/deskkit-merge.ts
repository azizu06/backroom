import { BufferAttribute, BufferGeometry, Color, Euler, Matrix4, Mesh, Quaternion, Vector3, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DESKKIT_TINT_MATERIAL, type KitPlacement } from './deskkit';

/**
 * Static batching for the desk kit: every placement is baked into world space, its material colour (or `tint`) is
 * baked into the vertex colours, and everything is merged into one mesh per surface finish. The kit then costs one
 * draw call per finish per pass however many desks, shelves and plants it places. The kit is static furniture
 * (placements change only with the visible rooms), so nothing here updates per frame.
 */
export interface DeskKitBatch {
  /** One mesh per surface finish, named `deskkit:<member material names>`. */
  meshes: Mesh[];
  dispose(): void;
}

/** Roughness bin width: kit materials closer than this in roughness share one draw call (stylised flat colours). */
export const DESKKIT_ROUGHNESS_STEP = 0.25;

type MeshLike = Object3D & { isMesh?: boolean; geometry?: BufferGeometry; material?: Material | Material[] };
type ColorMaterial = Material & { color: Color };
type FinishMaterial = ColorMaterial & {
  roughness?: number; metalness?: number; emissive?: Color; emissiveIntensity?: number; map?: { uuid: string } | null;
};

/** Everything but the base colour (which moves into the vertex colours) that decides how a surface shades. */
export function finishKey(material: Material): string {
  const m = material as FinishMaterial;
  return [m.type, m.side, m.transparent, m.opacity, m.alphaTest, m.metalness ?? '', m.roughness === undefined ? '' : Math.round(m.roughness / DESKKIT_ROUGHNESS_STEP),
    m.emissive?.getHexString() ?? '', m.emissiveIntensity ?? '', m.map?.uuid ?? ''].join('|');
}
interface Part { geometry: BufferGeometry; material: Material; local: Matrix4 }

const KEPT_ATTRIBUTES = ['position', 'normal', 'color'] as const;

function hasColor(material: Material): material is ColorMaterial {
  return 'color' in material && (material as ColorMaterial).color instanceof Color;
}

/** Each mesh of a kit node with its transform relative to the node origin (the placement point). */
function nodeParts(node: Object3D): Part[] {
  node.updateMatrixWorld(true);
  const inverse = node.matrixWorld.clone().invert();
  const parts: Part[] = [];
  node.traverse(child => {
    const mesh = child as MeshLike;
    if (!mesh.isMesh || !mesh.geometry || !mesh.material) return;
    const local = inverse.clone().multiply(mesh.matrixWorld);
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = Array.isArray(mesh.material) && mesh.geometry.groups.length ? mesh.geometry.groups : [null];
    groups.forEach((group, i) => {
      const material = group ? materials[group.materialIndex ?? i] : materials[0];
      if (!material) return;
      parts.push({ geometry: group ? subGeometry(mesh.geometry!, group.start, group.count) : mesh.geometry!, material, local });
    });
  });
  return parts;
}

function subGeometry(geometry: BufferGeometry, start: number, count: number): BufferGeometry {
  const source = geometry.index ? geometry : geometry.toNonIndexed();
  const out = new BufferGeometry();
  for (const name of KEPT_ATTRIBUTES) { const attribute = source.getAttribute(name); if (attribute) out.setAttribute(name, attribute); }
  const index = source.index ? Array.from(source.index.array).slice(start, start + count) : null;
  out.setIndex(index ?? Array.from({ length: count }, (_, i) => start + i));
  return out;
}

/** A detached float copy (handles interleaved and normalised glTF attributes) so every batch merges cleanly. */
function floatAttribute(attribute: BufferGeometry['attributes'][string], itemSize = attribute.itemSize): BufferAttribute {
  const array = new Float32Array(attribute.count * itemSize);
  for (let i = 0; i < attribute.count; i++) {
    for (let c = 0; c < itemSize; c++) array[i * itemSize + c] = c < attribute.itemSize ? attribute.getComponent(i, c) : 1;
  }
  return new BufferAttribute(array, itemSize);
}

function bakedPart(part: Part, world: Matrix4, tint: Color): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const name of KEPT_ATTRIBUTES) {
    const attribute = part.geometry.getAttribute(name);
    if (attribute) geometry.setAttribute(name, floatAttribute(attribute, name === 'color' ? 4 : attribute.itemSize));
  }
  const count = geometry.getAttribute('position').count;
  if (!geometry.getAttribute('color')) geometry.setAttribute('color', new BufferAttribute(new Float32Array(count * 4).fill(1), 4));
  const color = geometry.getAttribute('color') as BufferAttribute;
  for (let i = 0; i < count; i++) color.setXYZ(i, color.getX(i) * tint.r, color.getY(i) * tint.g, color.getZ(i) * tint.b);
  if (part.geometry.index) geometry.setIndex(new BufferAttribute(Uint32Array.from(part.geometry.index.array), 1));
  else geometry.setIndex(Array.from({ length: count }, (_, i) => i));
  geometry.applyMatrix4(world);
  return geometry;
}

/** Merges the placements of loaded kit nodes into one static mesh per finish. Every placement's node must exist. */
export function buildDeskKitBatch(templates: ReadonlyMap<string, Object3D>, placements: readonly KitPlacement[]): DeskKitBatch {
  const partsByNode = new Map<string, Part[]>();
  const byFinish = new Map<string, { materials: Set<Material>; geometries: BufferGeometry[] }>();
  const world = new Matrix4(), rotation = new Quaternion(), euler = new Euler(), position = new Vector3(), scale = new Vector3();
  for (const placement of placements) {
    const node = templates.get(placement.node);
    if (!node) throw new Error(`Desk kit node ${placement.node} is missing`);
    let parts = partsByNode.get(placement.node);
    if (!parts) { parts = nodeParts(node); partsByNode.set(placement.node, parts); }
    world.compose(position.set(...placement.at), rotation.setFromEuler(euler.set(0, placement.rotationY, 0)),
      placement.scale ? scale.set(...placement.scale) : scale.set(1, 1, 1));
    for (const part of parts) {
      const base = hasColor(part.material) ? part.material.color : new Color(1, 1, 1);
      const tint = part.material.name === DESKKIT_TINT_MATERIAL && placement.tint ? new Color(placement.tint) : base;
      const key = finishKey(part.material);
      const batch = byFinish.get(key) ?? { materials: new Set<Material>(), geometries: [] };
      batch.materials.add(part.material);
      batch.geometries.push(bakedPart(part, world.clone().multiply(part.local), tint));
      byFinish.set(key, batch);
    }
  }
  const owned: Material[] = [];
  const meshes: Mesh[] = [];
  for (const { materials, geometries } of byFinish.values()) {
    const merged = mergeGeometries(geometries, false);
    geometries.forEach(geometry => geometry.dispose());
    const members = [...materials];
    const names = members.map(material => material.name).sort().join('+');
    if (!merged) throw new Error(`Desk kit materials ${names} could not be merged`);
    // A white copy: each vertex already carries its material's colour (or the placement's tint).
    const drawn = members[0]!.clone() as FinishMaterial;
    if (hasColor(drawn)) drawn.color.set(0xffffff);
    drawn.vertexColors = true;
    const roughness = members.map(material => (material as FinishMaterial).roughness).filter((r): r is number => r !== undefined);
    if (roughness.length) drawn.roughness = roughness.reduce((sum, r) => sum + r, 0) / roughness.length;
    drawn.name = names;
    owned.push(drawn);
    const mesh = new Mesh(merged, drawn);
    mesh.name = `deskkit:${names}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    meshes.push(mesh);
  }
  return {
    meshes,
    dispose() {
      meshes.forEach(mesh => mesh.geometry.dispose());
      owned.forEach(material => material.dispose());
    },
  };
}
