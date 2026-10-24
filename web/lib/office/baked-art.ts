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
