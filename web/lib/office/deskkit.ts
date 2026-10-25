import { BAKED_REPLACES } from './baked-art';
import { OFFICE_ANCHORS, type AnchorId } from './state';
import { DESKS } from './targets/desk';
import { MONITOR_FACE } from './props/monitors';
import { DRESSING, type DressingPlant, type DressingShelf } from './props/dressing';
import { ROOM_DETAILS, type RoomDetailItem } from './props/roomDetail';
import { roomPoint } from './layout';

/**
 * Desk kit (tools/bake/deskkit.py -> deskkit.glb): named stylized props placed on the existing procedural anchors
 * under `?art=baked`. Placements are derived from the same anchor data the procedural props use (OFFICE_ANCHORS,
 * DESKS, DRESSING, ROOM_DETAILS), so they follow any layout change. Footprints match the procedural pieces, so
 * Play colliders are unchanged. View-only: nothing here decides anything.
 */
export const DESKKIT_GLB_URL = '/office-art/deskkit.glb';

/** Node names deskkit.py exports. Origin at the floor contact point (wall pieces: on the wall), front +z. */
export const DESKKIT_NODES = [
  'desk', 'chair', 'monitor', 'keyboard', 'desk_lamp', 'filing_cabinet', 'bookshelf', 'plant_small', 'plant_medium',
  'plant_large', 'whiteboard', 'wall_art', 'rug', 'mug', 'tray', 'vault_body', 'vault_door', 'safe', 'meeting_table',
  'kitchen_counter', 'kettle', 'fridge',
] as const;
export type DeskKitNode = typeof DESKKIT_NODES[number];
/** Material name in the kit that a placement's `tint` recolours (chair fabric, rug border, art hills). */
export const DESKKIT_TINT_MATERIAL = 'tint';

/** Procedural sources the kit replaces once it has loaded. Anything not listed keeps its procedural look. */
export type DeskKitSource = 'desk' | 'shelf' | 'floor-plant' | 'treasury-vault' | `detail:${KitDetailKind}`;
export const KIT_DETAIL_KINDS = ['rug', 'art', 'plant', 'mug', 'papers', 'lamp'] as const satisfies readonly RoomDetailItem['kind'][];
export type KitDetailKind = typeof KIT_DETAIL_KINDS[number];

export interface KitPlacement {
  /** Stable key. */
  id: string;
  node: DeskKitNode;
  room: AnchorId;
  source: DeskKitSource;
  at: [x: number, y: number, z: number];
  rotationY: number;
  scale?: [x: number, y: number, z: number];
  /** Colour for the node's `tint` material. */
  tint?: string;
}

/** Procedural Treasury vault (TreasuryVault.tsx): body centre on the floor and its size; the door is on the -z face. */
export const TREASURY_VAULT = { x: roomPoint('treasury', 0, 0.6)[0], z: roomPoint('treasury', 0, 0.6)[1], width: 1.8, height: 1.4, depth: 1.25 } as const;
/** Bookshelf width in the kit; each placement scales x to the procedural shelf width. */
export const KIT_SHELF_WIDTH = 1.4;
/** Desk-local offsets (furniture.ts deskPieces), floor or desk-top contact points. */
const DESK_TOP = 0.91;
const CHAIR_LOCAL: readonly [x: number, z: number] = [0.05, 0.9];
const KEYBOARD_LOCAL: readonly [x: number, z: number, turn: number] = [0.65, 0.1, -0.12];
const ART_DEPTH = 0.04;

export interface KitDesk { room: AnchorId; center: readonly [x: number, z: number]; flip: 1 | -1; tint: string }
export interface KitSources {
  desks: readonly KitDesk[];
  shelves: readonly DressingShelf[];
  plants: readonly DressingPlant[];
  details: readonly RoomDetailItem[];
  vault: { room: AnchorId; x: number; z: number; depth: number } | null;
}

/** The live layout's anchors. A layout change (new rooms, moved anchors) flows through here unchanged. */
export function kitSources(): KitSources {
  return {
    desks: DESKS.map(room => ({ room, center: OFFICE_ANCHORS[room].center, flip: room === 'dana' ? -1 : 1, tint: OFFICE_ANCHORS[room].color })),
    shelves: DRESSING.shelves,
    plants: DRESSING.plants,
    details: [], // Partition decorations are detached in the open office.
    vault: { room: 'treasury', x: TREASURY_VAULT.x, z: TREASURY_VAULT.z, depth: TREASURY_VAULT.depth },
  };
}

/** Rooms whose baked shell already brings its own props (the baked lobby); the kit leaves them alone. */
export function kitCoversRoom(room: string): boolean {
  return !BAKED_REPLACES.props.includes(room);
}

const DETAIL_NODE: Record<KitDetailKind, DeskKitNode> = {
  rug: 'rug', art: 'wall_art', plant: 'plant_small', mug: 'mug', papers: 'tray', lamp: 'desk_lamp',
};

function deskPlacements({ room, center: [x, z], flip, tint }: KitDesk): KitPlacement[] {
  const facing = flip === -1 ? Math.PI : 0;
  const local = (lx: number, lz: number): [number, number] => [x + flip * lx, z + flip * lz];
  const [cx, cz] = local(...CHAIR_LOCAL);
  const [kx, kz] = local(KEYBOARD_LOCAL[0], KEYBOARD_LOCAL[1]);
  const [mx, mz] = local(MONITOR_FACE.x, MONITOR_FACE.z);
  return [
    { id: `${room}:desk`, node: 'desk', room, source: 'desk', at: [x, 0, z], rotationY: facing },
    { id: `${room}:chair`, node: 'chair', room, source: 'desk', at: [cx, 0, cz], rotationY: facing + Math.PI, tint },
    { id: `${room}:keyboard`, node: 'keyboard', room, source: 'desk', at: [kx, DESK_TOP, kz], rotationY: facing + KEYBOARD_LOCAL[2] },
    // Every live screen faces +z (deskScreenPiece), Dana's too, so the casing never turns.
    { id: `${room}:monitor`, node: 'monitor', room, source: 'desk', at: [mx, DESK_TOP, mz], rotationY: facing },
  ];
}

function detailPlacement(detail: RoomDetailItem): KitPlacement | null {
  if (!(KIT_DETAIL_KINDS as readonly string[]).includes(detail.kind)) return null;
  const kind = detail.kind as KitDetailKind;
  const first = detail.pieces[0];
  if (!first) return null;
  const rotationY = first.rotation?.[1] ?? 0;
  const base = { id: detail.id, node: DETAIL_NODE[kind], room: detail.room, source: `detail:${kind}` as const, rotationY };
  const [x, y, z] = first.at;
  const bottom = y - first.size[1] / 2;
  if (kind === 'rug') return { ...base, at: [x, bottom, z], scale: [first.size[0], 1, first.size[2]], tint: first.color };
  if (kind === 'art') {
    // The frame's centre sits ART_DEPTH / 2 off the wall along its facing; the kit origin is on the wall.
    const back = ART_DEPTH / 2;
    const accent = detail.pieces[3]?.color;
    return { ...base, at: [x - back * Math.sin(rotationY), y, z - back * Math.cos(rotationY)], ...(accent ? { tint: accent } : {}) };
  }
  // Plants on a desk or the vault read a little taller than the shelf-top ones.
  const node: DeskKitNode = kind === 'plant' && bottom > 1 ? 'plant_medium' : DETAIL_NODE[kind];
  return { ...base, node, at: [x, bottom, z] };
}

/** Every kit placement for the visible rooms, in a stable order. */
export function deskKitPlacements(rooms: readonly AnchorId[], sources: KitSources = kitSources()): KitPlacement[] {
  const shown = new Set(rooms.filter(kitCoversRoom));
  const out: KitPlacement[] = [];
  for (const desk of sources.desks) if (shown.has(desk.room)) out.push(...deskPlacements(desk));
  sources.shelves.forEach((shelf, i) => {
    if (!shown.has(shelf.room)) return;
    out.push({ id: `${shelf.room}:shelf:${i}`, node: 'bookshelf', room: shelf.room, source: 'shelf', at: [shelf.x, 0, shelf.z],
      rotationY: shelf.rotationY, scale: [shelf.width / KIT_SHELF_WIDTH, 1, 1] });
  });
  sources.plants.forEach((plant, i) => {
    if (!shown.has(plant.room)) return;
    out.push({ id: `${plant.room}:floor-plant:${i}`, node: 'plant_large', room: plant.room, source: 'floor-plant', at: [plant.x, 0, plant.z],
      rotationY: i * 1.3, scale: [plant.size, plant.size, plant.size] });
  });
  const { vault } = sources;
  if (vault && shown.has(vault.room)) {
    // The procedural door faces -z (towards the Treasury doorway); the kit's door faces +z, so both turn round.
    out.push({ id: `${vault.room}:vault-body`, node: 'vault_body', room: vault.room, source: 'treasury-vault', at: [vault.x, 0, vault.z], rotationY: Math.PI });
    out.push({ id: `${vault.room}:vault-door`, node: 'vault_door', room: vault.room, source: 'treasury-vault', at: [vault.x, 0, vault.z - vault.depth / 2], rotationY: Math.PI });
  }
  for (const detail of sources.details) {
    if (!shown.has(detail.room)) continue;
    const placement = detailPlacement(detail);
    if (placement) out.push(placement);
  }
  return out;
}

/** Kit nodes the placements need that the loaded GLB lacks; any gap keeps the whole procedural set. */
export function missingKitNodes(placements: readonly KitPlacement[], available: ReadonlySet<string>): DeskKitNode[] {
  return [...new Set(placements.map(p => p.node))].filter(node => !available.has(node));
}

/**
 * True when the loaded kit draws this procedural piece instead. `ready` is set only by the DeskKit mount after
 * deskkit.glb loaded with every needed node (so only under `?art=baked`); otherwise the procedural piece stays.
 */
export function deskKitReplaces(ready: boolean, room: string): boolean {
  return ready && kitCoversRoom(room);
}

/** Room-detail kinds the kit draws (books stay procedural). */
export function kitReplacesDetail(ready: boolean, detail: Pick<RoomDetailItem, 'kind' | 'room'>): boolean {
  return (KIT_DETAIL_KINDS as readonly string[]).includes(detail.kind) && deskKitReplaces(ready, detail.room);
}

// ---- ready flag: the DeskKit mount publishes it; procedural mounts subscribe -------------------------------------
let kitReady = false;
const listeners = new Set<() => void>();
export function deskKitReady(): boolean { return kitReady; }
export function setDeskKitReady(ready: boolean): void {
  if (kitReady === ready) return;
  kitReady = ready;
  listeners.forEach(listener => listener());
}
export function subscribeDeskKit(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
