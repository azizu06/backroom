import { readFileSync } from 'node:fs';
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import manifest from '../../public/office-art/propkit.nodes.json';
import colliders from '../../public/office-art/propkit.colliders.json';
import { PALETTE } from './palette';
import { PROPKIT_NODES, PROPKIT_SPECS, currentPropKitLayout, propkitColliderBoxes, propkitPlacements } from './propkit';

const script = readFileSync(new URL('../../../tools/bake/propkit.py', import.meta.url), 'utf8');

interface BakedGltf {
  asset: { version: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: { name: string; mesh: number }[];
  meshes: { primitives: { attributes: { POSITION: number; TEXCOORD_0: number }; indices: number; material: number; mode?: number }[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { byteLength: number; uri?: string }[];
  materials: { pbrMetallicRoughness: { baseColorTexture: { index: number } } }[];
  textures: { source: number }[];
  images: { bufferView: number; mimeType: string; uri?: string }[];
}

// These are required repository assets: missing files must fail, never skip.
const glb = readFileSync(new URL('../../public/office-art/propkit.glb', import.meta.url));
const png = readFileSync(new URL('../../public/office-art/propkit_lightmap.png', import.meta.url));
const jsonLength = glb.readUInt32LE(12), binHeader = 20 + jsonLength;
const gltf: BakedGltf = JSON.parse(glb.subarray(20, binHeader).toString('utf8'));
const binary = glb.subarray(binHeader + 8);

describe('prop kit bake / runtime contract', () => {
  it('uses the same twelve envelopes and collision flags before a bake exists', () => {
    const specs = Object.fromEntries([...script.matchAll(/"(\w+)": \(\(([\d., ]+)\), (True|False)\)/g)]
      .map(([, name, dimensions, solid]) => [name, { size: dimensions!.split(',').map(Number), solid: solid === 'True' }]));
    expect(Object.keys(specs)).toEqual(PROPKIT_NODES);
    expect(specs).toEqual(PROPKIT_SPECS);
  });

  it('models only in the office palette with the permitted bake imports', () => {
    for (const [name, hex] of Object.entries(PALETTE)) expect(script).toContain(`"${name}": "${hex.slice(1)}"`);
    const imports = [...script.matchAll(/^(?:from|import) (\w+)/gm)].map(match => match[1]);
    expect(imports.sort()).toEqual(['bmesh', 'bpy', 'json', 'math', 'mathutils', 'os', 'sys']);
  });

  it('ships a complete GLB below 1.5 MB with exactly the twelve root mesh nodes', () => {
    expect(glb.length).toBeLessThanOrEqual(1_500_000);
    expect(glb.readUInt32LE(0)).toBe(0x46546c67); // glTF
    expect(glb.readUInt32LE(4)).toBe(2);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    expect(glb.readUInt32LE(16)).toBe(0x4e4f534a); // JSON
    expect(glb.readUInt32LE(binHeader + 4)).toBe(0x004e4942); // BIN
    expect(glb.readUInt32LE(binHeader)).toBe(binary.length);
    expect(gltf.asset.version).toBe('2.0');
    expect(gltf.buffers).toEqual([{ byteLength: binary.length }]);
    for (const view of gltf.bufferViews) {
      expect(view.buffer).toBe(0);
      expect(view.byteOffset ?? 0).toBeGreaterThanOrEqual(0);
      expect((view.byteOffset ?? 0) + view.byteLength).toBeLessThanOrEqual(binary.length);
    }
    const names = [...PROPKIT_NODES].sort();
    expect(manifest.kit).toBe('propkit');
    expect(Object.keys(manifest.nodes).sort()).toEqual(names);
    expect(gltf.nodes.map(node => node.name).sort()).toEqual(names);
    expect(gltf.meshes).toHaveLength(names.length);
    expect(new Set(gltf.nodes.map(node => node.mesh)).size).toBe(names.length);
    expect(gltf.scenes).toHaveLength(1);
    expect(gltf.scenes[gltf.scene]!.nodes).toEqual(gltf.nodes.map((_, index) => index));
    for (const node of gltf.nodes) {
      // No parent, translation, rotation or scale: geometry is already Y-up and node-local.
      expect(node).toEqual({ name: node.name, mesh: expect.any(Number) });
      expect(gltf.meshes[node.mesh]!.primitives).toHaveLength(1); // one instanced draw per node
    }
  });

  it('embeds the same single PNG atlas as the standalone file, at most 1024 px', () => {
    expect(gltf.materials).toHaveLength(1);
    expect(gltf.materials[0]!.pbrMetallicRoughness.baseColorTexture.index).toBe(0);
    expect(gltf.textures).toHaveLength(1);
    expect(gltf.textures[0]!.source).toBe(0);
    expect(gltf.images).toHaveLength(1);
    const image = gltf.images[0]!, view = gltf.bufferViews[image.bufferView]!;
    expect(image.mimeType).toBe('image/png');
    expect(image.uri).toBeUndefined();
    const start = view.byteOffset ?? 0;
    expect(binary.subarray(start, start + view.byteLength).equals(png)).toBe(true);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    expect(manifest.lightmap).toEqual({ width, height });
    for (const size of [width, height]) {
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(1024);
    }
  });

  it.each(PROPKIT_NODES)('%s geometry matches its manifest, triangle count and placement envelope', name => {
    const node = gltf.nodes.find(node => node.name === name)!;
    const primitive = gltf.meshes[node.mesh]!.primitives[0]!;
    expect(primitive.mode ?? 4).toBe(4); // TRIANGLES
    expect(primitive.material).toBe(0);
    const position = gltf.accessors[primitive.attributes.POSITION]!;
    const uv = gltf.accessors[primitive.attributes.TEXCOORD_0]!;
    const indices = gltf.accessors[primitive.indices]!;
    expect(position).toMatchObject({ componentType: 5126, type: 'VEC3' });
    expect(position.count).toBeGreaterThan(0);
    expect(uv).toMatchObject({ componentType: 5126, type: 'VEC2', count: position.count });
    expect(indices).toMatchObject({ componentType: 5123, type: 'SCALAR' });
    expect(indices.count).toBeGreaterThan(0);
    expect(indices.count % 3).toBe(0);
    const entry = manifest.nodes[name], [w, h, d] = PROPKIT_SPECS[name].size;
    expect(entry.name).toBe(name);
    expect(entry.solid).toBe(PROPKIT_SPECS[name].solid);
    expect(entry.triangles).toBe(indices.count / 3);
    expect(entry.footprint).toEqual({ minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 });

    // Read real vertex/index bytes, not just the JSON accessor bounds.
    const view = gltf.bufferViews[position.bufferView]!;
    const start = (view.byteOffset ?? 0) + (position.byteOffset ?? 0), stride = view.byteStride ?? 12;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    expect((position.byteOffset ?? 0) + (position.count - 1) * stride + 12).toBeLessThanOrEqual(view.byteLength);
    for (let i = 0; i < position.count; i++) for (let axis = 0; axis < 3; axis++) {
      const value = binary.readFloatLE(start + i * stride + axis * 4);
      expect(Number.isFinite(value)).toBe(true);
      min[axis] = Math.min(min[axis]!, value); max[axis] = Math.max(max[axis]!, value);
    }
    for (let axis = 0; axis < 3; axis++) {
      expect(min[axis]).toBeCloseTo(entry.bounds.min[axis]!, 6);
      expect(max[axis]).toBeCloseTo(entry.bounds.max[axis]!, 6);
      expect(min[axis]).toBeCloseTo(position.min![axis]!, 6);
      expect(max[axis]).toBeCloseTo(position.max![axis]!, 6);
      // Match propkit.py's 5 mm modelling tolerance (arcade trim projects 2 mm).
      expect(min[axis]).toBeGreaterThanOrEqual([-w / 2, 0, -d / 2][axis]! - 0.005);
      expect(max[axis]).toBeLessThanOrEqual([w / 2, h, d / 2][axis]! + 0.005);
    }
    const indexView = gltf.bufferViews[indices.bufferView]!;
    const indexStart = (indexView.byteOffset ?? 0) + (indices.byteOffset ?? 0);
    expect((indices.byteOffset ?? 0) + indices.count * 2).toBeLessThanOrEqual(indexView.byteLength);
    for (let i = 0; i < indices.count; i++) expect(binary.readUInt16LE(indexStart + i * 2)).toBeLessThan(position.count);
  });

  it('ships node-local collider boxes that reproduce the placed runtime colliders', () => {
    expect(colliders).toEqual({ kit: 'propkit', space: 'node-local', boxes:
      PROPKIT_NODES.filter(name => PROPKIT_SPECS[name].solid)
        .map(name => ({ name, ...manifest.nodes[name].footprint })),
    });
    const layout = currentPropKitLayout(), boxes = propkitColliderBoxes(layout);
    const placements = propkitPlacements(layout).filter(p => PROPKIT_SPECS[p.node].solid);
    expect(boxes).toHaveLength(placements.length);
    for (const p of placements) {
      const local = colliders.boxes.find(box => box.name === p.node)!;
      const transform = new Matrix4().makeRotationY(p.rotation)
        .scale(new Vector3(...(p.scale ?? [1, 1, 1]))).setPosition(...p.position);
      const corners = [local.minX, local.maxX].flatMap(x => [local.minZ, local.maxZ]
        .map(z => new Vector3(x, 0, z).applyMatrix4(transform)));
      const expected = { minX: Math.min(...corners.map(v => v.x)), maxX: Math.max(...corners.map(v => v.x)),
        minZ: Math.min(...corners.map(v => v.z)), maxZ: Math.max(...corners.map(v => v.z)) };
      const actual = boxes.find(box => box.name === `propkit:${p.id}`)!;
      for (const edge of ['minX', 'maxX', 'minZ', 'maxZ'] as const) expect(actual[edge], p.id).toBeCloseTo(expected[edge], 6);
    }
  });
});
