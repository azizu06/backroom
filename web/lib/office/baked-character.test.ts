import { afterEach, describe, expect, it, vi } from 'vitest';
import { PALETTE } from './palette';
import {
  CHARACTER_CLIPS, CHARACTER_VARIANTS, applyCharacterVariant, atOwnDesk, bakedTalkingAgent, characterClip, characterVariant,
  setBakedTalkingAgent, subscribeBakedTalking, variantOfNode, wantedClip,
} from './baked-character';
import { OFFICE_ANCHORS } from './state';
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

describe('baked character role variants', () => {
  it('maps each agent seat and Dana onto its own variant', () => {
    expect(characterVariant('collections')).toBe('collections');
    expect(characterVariant('payables')).toBe('payables');
    expect(characterVariant('vendor_onboarding')).toBe('vendor');
    expect(characterVariant('dana')).toBe('dana');
    expect(new Set(['collections', 'payables', 'vendor_onboarding', 'dana'].map(characterVariant)).size).toBe(CHARACTER_VARIANTS.length);
  });

  it('gives unknown seats the bare base body', () => {
    expect(characterVariant('treasury')).toBeNull();
    expect(characterVariant('toString')).toBeNull();
  });

  it('reads the variant from accessory node names only', () => {
    expect(variantOfNode('v_collections_headset')).toBe('collections');
    expect(variantOfNode('v_vendor_cardigan_1')).toBe('vendor');
    expect(variantOfNode('body')).toBeNull();
    expect(variantOfNode('hair')).toBeNull();
    expect(variantOfNode('rig')).toBeNull();
  });

  function nodes(...names: string[]) {
    const list = names.map(name => ({ name, visible: true }));
    return { list, traverse(visit: (node: object) => void) { for (const node of list) visit(node); } };
  }

  it('shows only the chosen variant and keeps the base body', () => {
    const root = nodes('body', 'skin', 'v_collections_headset', 'v_payables_glasses', 'v_vendor_folder', 'v_dana_mug');
    expect(applyCharacterVariant(root, 'payables')).toBe(4);
    expect(root.list.filter(node => node.visible).map(node => node.name)).toEqual(['body', 'skin', 'v_payables_glasses']);
    applyCharacterVariant(root, null);
    expect(root.list.filter(node => node.visible).map(node => node.name)).toEqual(['body', 'skin']);
  });

  it('leaves an older GLB without variants whole', () => {
    const root = nodes('body', 'skin', 'hair', 'legs', 'face');
    expect(applyCharacterVariant(root, 'collections')).toBe(0);
    expect(root.list.every(node => node.visible)).toBe(true);
  });
});

describe('baked character clips', () => {
  const all = new Set<string>(CHARACTER_CLIPS);
  const still = { moving: false, talking: false, atDesk: false };

  it('maps agent state onto a clip: walk beats talk beats type beats idle', () => {
    expect(wantedClip(still)).toBe('idle');
    expect(wantedClip({ ...still, atDesk: true })).toBe('type');
    expect(wantedClip({ ...still, atDesk: true, talking: true })).toBe('talk');
    expect(wantedClip({ moving: true, talking: true, atDesk: true })).toBe('walk');
    expect(characterClip({ ...still, moving: true }, all)).toBe('walk');
  });

  it('falls back to idle, then to a still pose, when clips are missing', () => {
    expect(characterClip({ ...still, talking: true }, new Set(['idle', 'walk']))).toBe('idle');
    expect(characterClip({ ...still, talking: true }, new Set(['talk']))).toBe('talk');
    expect(characterClip({ ...still, atDesk: true }, new Set(['walk']))).toBeNull();
    expect(characterClip(still, new Set())).toBeNull();
  });

  it('counts an agent at its own seat anchor as at its desk', () => {
    const [x, z] = OFFICE_ANCHORS.payables.position;
    expect(atOwnDesk('payables', x, z)).toBe(true);
    expect(atOwnDesk('payables', x + 0.3, z)).toBe(true);
    expect(atOwnDesk('payables', x + 2, z)).toBe(false);
    expect(atOwnDesk('collections', x, z)).toBe(false);
    expect(atOwnDesk('not-a-seat', 0, 0)).toBe(false);
  });

  it('tracks the agent the talk panel is open on and notifies on change only', () => {
    const seen = vi.fn();
    const stop = subscribeBakedTalking(seen);
    setBakedTalkingAgent('agent-1');
    setBakedTalkingAgent('agent-1');
    expect(bakedTalkingAgent()).toBe('agent-1');
    setBakedTalkingAgent(null);
    expect(bakedTalkingAgent()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(2);
    stop();
  });
});
