import { PALETTE, type PaletteName } from './palette';
import { OFFICE_ANCHORS, isAnchorId } from './state';

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

/**
 * Per-role accessory sets baked into the one character.glb (tools/bake/character.py). Accessory nodes are
 * named `v_<variant>_<item>`; the base body (`body`, `skin`, `hair`, `legs`, `face`) is shared by every variant.
 */
export const CHARACTER_VARIANTS = ['collections', 'payables', 'vendor', 'dana'] as const;
export type CharacterVariant = typeof CHARACTER_VARIANTS[number];

const SEAT_VARIANT: Partial<Record<string, CharacterVariant>> = {
  collections: 'collections',
  payables: 'payables',
  vendor_onboarding: 'vendor',
  dana: 'dana',
};

/** The accessory set for a seat or room id. Unknown seats get the bare base body (null). */
export function characterVariant(seatId: string): CharacterVariant | null {
  return Object.hasOwn(SEAT_VARIANT, seatId) ? SEAT_VARIANT[seatId]! : null;
}

/** The variant an accessory node belongs to, or null for base-body and rig nodes. */
export function variantOfNode(name: string): string | null {
  const match = /^v_([a-z]+)_/.exec(name);
  return match ? match[1]! : null;
}

export interface VariantNode { name: string; visible: boolean }

/**
 * Shows only `variant`'s accessories (null hides them all). Returns how many accessory nodes the tree has;
 * an older GLB without variants returns 0 and is drawn whole.
 */
export function applyCharacterVariant(root: { traverse(visit: (node: object) => void): void }, variant: CharacterVariant | null): number {
  let count = 0;
  root.traverse(node => {
    const item = node as VariantNode;
    const owner = variantOfNode(item.name);
    if (!owner) return;
    count += 1;
    item.visible = owner === variant;
  });
  return count;
}

/** Looping glTF clips baked into character.glb. */
export const CHARACTER_CLIPS = ['idle', 'walk', 'talk', 'type'] as const;
export type CharacterClip = typeof CHARACTER_CLIPS[number];
/** The walk clip is one 1 s stride cycle; the avatars walk 2.4 m/s, so it runs faster to keep feet roughly planted. */
export const WALK_CLIP_SPEED = 2.2;
/** Cross-fade between clips, seconds. Frames are requested only while a fade runs (or the talk clip plays). */
export const CLIP_FADE_SECONDS = 0.25;
/** How close (m) to its seat anchor a standing agent counts as at its desk. */
export const DESK_RADIUS_M = 0.45;

export interface CharacterActivity {
  /** The avatar moved this frame (a walk, e.g. carrying a handoff). */
  readonly moving: boolean;
  /** The Play talk panel is open on this agent. */
  readonly talking: boolean;
  /** Standing at its own desk. */
  readonly atDesk: boolean;
}

/** Walking wins (legs must move), then talking, then typing at the desk, else idle. */
export function wantedClip(activity: CharacterActivity): CharacterClip {
  if (activity.moving) return 'walk';
  if (activity.talking) return 'talk';
  if (activity.atDesk) return 'type';
  return 'idle';
}

/** The clip to play given what the GLB has: the wanted one, else idle, else none (static pose). */
export function characterClip(activity: CharacterActivity, available: ReadonlySet<string>): CharacterClip | null {
  const wanted = wantedClip(activity);
  if (available.has(wanted)) return wanted;
  return available.has('idle') ? 'idle' : null;
}

export function atOwnDesk(seatId: string, x: number, z: number, radius = DESK_RADIUS_M): boolean {
  if (!isAnchorId(seatId)) return false;
  const [ax, az] = OFFICE_ANCHORS[seatId].position;
  return Math.hypot(x - ax, z - az) <= radius;
}

let talkingAgent: string | null = null;
const talkListeners = new Set<() => void>();

/** Set by the Play HUD while its talk panel is open on an agent; read by the baked characters (view only). */
export function setBakedTalkingAgent(agentId: string | null): void {
  if (agentId === talkingAgent) return;
  talkingAgent = agentId;
  for (const listener of talkListeners) listener();
}

export function bakedTalkingAgent(): string | null {
  return talkingAgent;
}

export function subscribeBakedTalking(listener: () => void): () => void {
  talkListeners.add(listener);
  return () => { talkListeners.delete(listener); };
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
