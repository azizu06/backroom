import { PALETTE, type PaletteName } from './palette';

/** Public GLB. Fetched only when `?art=baked` asks the character mount to load it. */
export const CHARACTER_GLB_URL = '/office-art/character.glb';
/** glTF node and material the bake script names for the shirt. */
export const BODY_MATERIAL_NAME = 'body';
/**
 * character.glb faces -Z at identity. Avatar heading 0 faces +Z
 * (WalkMotion.heading = atan2(dx, dz); see the Treasury deny echo).
 */
export const CHARACTER_YAW_OFFSET = Math.PI;

/**
 * Shirt colours for the baked character. The blocky figure keeps each seat's anchor hex;
 * those hexes are not palette tokens, so the GLB shirt uses the palette role for that seat.
 * Unknown seats get slate.
 */
const SEAT_BODY: Partial<Record<string, PaletteName>> = {
  collections: 'mint',
  payables: 'butter',
  vendor_onboarding: 'lavender',
};

export function agentBodyColor(seatId: string): string {
  const role: PaletteName = SEAT_BODY[seatId] ?? 'slate';
  return PALETTE[role];
}

export function characterYaw(avatarYaw: number): number {
  return avatarYaw + CHARACTER_YAW_OFFSET;
}

export interface BodyMaterial {
  name: string;
  color: { set(color: string): void };
  clone(): BodyMaterial;
  userData?: { clonedBody?: boolean };
  dispose?(): void;
}

export interface BodyNode {
  name: string;
  isMesh?: boolean;
  material?: BodyMaterial | BodyMaterial[];
}

function materialsOf(node: BodyNode): BodyMaterial[] {
  if (!node.material) return [];
  return Array.isArray(node.material) ? node.material : [node.material];
}

/** Clones the shared `body` material and tints it. Other materials stay shared with the template. */
export function recolorBody(root: { traverse(visit: (node: object) => void): void }, color: string): void {
  root.traverse(node => {
    const mesh = node as BodyNode;
    if (!mesh.isMesh || !mesh.material) return;
    const list = materialsOf(mesh);
    let changed = false;
    const next = list.map(material => {
      const namedBody = material.name === BODY_MATERIAL_NAME;
      const unnamedOnBody = mesh.name === BODY_MATERIAL_NAME && material.name === '';
      if (!namedBody && !unnamedOnBody) return material;
      const copy = material.clone();
      copy.name = material.name;
      copy.color.set(color);
      copy.userData = { ...copy.userData, clonedBody: true };
      changed = true;
      return copy;
    });
    if (!changed) return;
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
}

/** Disposes only the per-agent shirt clones. Shared geometry and the template's materials stay. */
export function disposeClonedBody(root: { traverse(visit: (node: object) => void): void }): void {
  root.traverse(node => {
    const mesh = node as BodyNode;
    if (!mesh.isMesh) return;
    for (const material of materialsOf(mesh)) {
      if (material.userData?.clonedBody) material.dispose?.();
    }
  });
}

let version = 0;
const ready = new Set<string>();
const listeners = new Set<() => void>();

/** Bumps when the set of agents wearing the GLB changes. The avatar reads this to drop its blocks. */
export function bakedCharacterVersion(): number {
  return version;
}

export function bakedCharacterReady(agentId: string): boolean {
  return ready.has(agentId);
}

export function subscribeBakedCharacters(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setBakedCharacterReady(ids: readonly string[]): void {
  if (ids.length === ready.size && ids.every(id => ready.has(id))) return;
  ready.clear();
  for (const id of ids) ready.add(id);
  version += 1;
  for (const listener of listeners) listener();
}
