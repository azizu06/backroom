/** True for `?art=baked`. Pure so it is testable without the scene. */
export function bakedArtRequested(search: string): boolean {
  return new URLSearchParams(search).get('art') === 'baked';
}

/**
 * Procedural pieces that stand inside a baked room's shell and show through it, so they hide under `?art=baked`
 * only (the blocky default never reads this). `shell` pieces are replaced only while the baked walls are drawn
 * (first person); the overview hides the baked near walls, so it keeps the procedural partition as the divider.
 */
export const BAKED_REPLACES = {
  /** Rooms whose floor lamp and dressing plant the bake replaces with its own lamp and plants. */
  props: ['lobby'] as readonly string[],
  /** x of the partition segment (z > 0) that sits inside the baked lobby's east wall. */
  shellPartitionX: [-2.5] as readonly number[],
};

/** True when the baked room replaces this room's procedural floor lamp and dressing plant. */
export function bakedReplacesProps(baked: boolean, room: string): boolean {
  return baked && BAKED_REPLACES.props.includes(room);
}

/** True when the baked shell covers the front partition segment at x (baked art on, first-person walls drawn). */
export function bakedReplacesPartition(baked: boolean, overview: boolean, x: number): boolean {
  return baked && !overview && BAKED_REPLACES.shellPartitionX.includes(x);
}

/**
 * The freestanding procedural audit board (LobbyCounter frame at x -5.9, z 3.9, 2 m wide; its deny stamp and glow
 * ride on it). In first person under baked art it stands in front of the baked west wall and blocks the window view,
 * while the audit wall mount on that wall shows the same receipts, so it hides there; the overview keeps it.
 */
export const LOBBY_AUDIT_BOARD = { x: -5.9, z: 3.9, width: 2, depth: 0.15 } as const;

/** True when the baked lobby replaces the procedural audit board (baked art on, first-person walls drawn). */
export function bakedReplacesAuditBoard(baked: boolean, overview: boolean): boolean {
  return baked && !overview;
}

/** Play colliders without the audit board's footprint when baked art hides it (Play is always first person). */
export function withoutHiddenAuditBoard<T extends { minX: number; maxX: number; minZ: number; maxZ: number }>(boxes: readonly T[], baked: boolean): T[] {
  if (!bakedReplacesAuditBoard(baked, false)) return [...boxes];
  const { x, z, width, depth } = LOBBY_AUDIT_BOARD;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  return boxes.filter(b => !(near(b.minX, x - width / 2) && near(b.maxX, x + width / 2) && near(b.minZ, z - depth / 2) && near(b.maxZ, z + depth / 2)));
}

/**
 * Baked pieces actually in the scene. A piece is ready only after its GLB is added to the scene graph, and goes back
 * to not ready on a load failure or unmount, so every procedural replacement keys off a loaded room, never the query alone.
 */
const readyPieces = new Set<string>();
const readyListeners = new Set<() => void>();

export function setBakedPieceReady(piece: string, ready: boolean): void {
  if (readyPieces.has(piece) === ready) return;
  if (ready) readyPieces.add(piece); else readyPieces.delete(piece);
  readyListeners.forEach(listener => listener());
}

export function bakedPieceReady(piece: string): boolean {
  return readyPieces.has(piece);
}

export function subscribeBakedReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => { readyListeners.delete(listener); };
}

/** True when `?art=baked` is on and the piece is loaded: the only condition under which procedural pieces give way. */
export function bakedPieceActive(search: string, piece: string): boolean {
  return bakedArtRequested(search) && bakedPieceReady(piece);
}
