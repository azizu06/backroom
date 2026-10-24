import { afterEach, describe, expect, it, vi } from 'vitest';
import { PALETTE } from './palette';
import {
  BODY_MATERIAL_NAME, agentBodyColor, bakedCharacterReady, bakedCharacterVersion, characterYaw,
  disposeClonedBody, recolorBody, setBakedCharacterReady, subscribeBakedCharacters, type BodyMaterial, type BodyNode,
} from './baked-character';

function material(name: string): BodyMaterial & { color: { value: string; set(color: string): void } } {
  return {
    name,
    color: { value: '#ffffff', set(color: string) { this.value = color; } },
    userData: {},
    clone() {
      const copy = material(this.name);
      copy.color.value = this.color.value;
      return copy;
    },
    dispose: vi.fn(),
  };
}

function tree(shared: { body: BodyMaterial; skin: BodyMaterial }) {
  const nodes: BodyNode[] = [
    { name: 'body', isMesh: true, material: shared.body },
    { name: 'skin', isMesh: true, material: shared.skin },
  ];
  return { nodes, traverse(visit: (node: object) => void) { for (const node of nodes) visit(node); } };
}

describe('baked character shirts', () => {
  const palette = new Set<string>(Object.values(PALETTE));

  it('maps each seat onto its own palette colour', () => {
    const collections = agentBodyColor('collections');
    const payables = agentBodyColor('payables');
    const vendor = agentBodyColor('vendor_onboarding');
    expect(collections).toBe(PALETTE.mint);
    expect(payables).toBe(PALETTE.butter);
    expect(vendor).toBe(PALETTE.lavender);
    expect(new Set([collections, payables, vendor]).size).toBe(3);
    for (const color of [collections, payables, vendor, agentBodyColor('unknown'), agentBodyColor('')]) {
      expect(palette.has(color)).toBe(true);
    }
    expect(agentBodyColor('unknown')).toBe(PALETTE.slate);
  });

  it('clones the body material per agent and leaves the shared template alone', () => {
    const shared = { body: material(BODY_MATERIAL_NAME), skin: material('skin') };
    const alex = tree(shared);
    const sam = tree(shared);
    recolorBody(alex, agentBodyColor('collections'));
    recolorBody(sam, agentBodyColor('payables'));
    const alexBody = alex.nodes[0]!.material as BodyMaterial & { color: { value: string } };
    const samBody = sam.nodes[0]!.material as BodyMaterial & { color: { value: string } };
    expect(alexBody).not.toBe(shared.body);
    expect(samBody).not.toBe(alexBody);
    expect(alexBody.color.value).toBe(PALETTE.mint);
    expect(samBody.color.value).toBe(PALETTE.butter);
    expect(alexBody.userData?.clonedBody).toBe(true);
    expect(alex.nodes[1]!.material).toBe(shared.skin);
    expect(sam.nodes[1]!.material).toBe(shared.skin);
    expect((shared.body as { color: { value: string } }).color.value).toBe('#ffffff');
  });

  it('recolours an unnamed material on the body mesh and disposes only the clone', () => {
    const body = material('');
    const node: BodyNode = { name: BODY_MATERIAL_NAME, isMesh: true, material: body };
    const root = { traverse(visit: (entry: object) => void) { visit(node); } };
    recolorBody(root, PALETTE.mint);
    const tinted = node.material as BodyMaterial;
    expect(tinted).not.toBe(body);
    disposeClonedBody(root);
    expect(tinted.dispose).toHaveBeenCalledOnce();
    expect(body.dispose).not.toHaveBeenCalled();
  });

  it('turns the -Z bake to face avatar heading 0 (+Z)', () => {
    expect(characterYaw(0)).toBeCloseTo(Math.PI);
    expect(characterYaw(Math.PI)).toBeCloseTo(Math.PI * 2);
  });
});

describe('baked character readiness', () => {
  afterEach(() => { setBakedCharacterReady([]); });

  it('starts with nobody in the GLB and then marks the loaded agents', () => {
    expect(bakedCharacterVersion()).toBeGreaterThanOrEqual(0);
    expect(bakedCharacterReady('collections-clerk')).toBe(false);
    const seen = vi.fn();
    const stop = subscribeBakedCharacters(seen);
    const before = bakedCharacterVersion();
    setBakedCharacterReady(['collections-clerk', 'payables-clerk']);
    expect(bakedCharacterVersion()).toBe(before + 1);
    expect(seen).toHaveBeenCalledOnce();
    expect(bakedCharacterReady('collections-clerk')).toBe(true);
    expect(bakedCharacterReady('vendor-clerk')).toBe(false);
    setBakedCharacterReady(['payables-clerk', 'collections-clerk']);
    expect(bakedCharacterVersion()).toBe(before + 1);
    stop();
    setBakedCharacterReady(['collections-clerk']);
    expect(seen).toHaveBeenCalledOnce();
  });
});
