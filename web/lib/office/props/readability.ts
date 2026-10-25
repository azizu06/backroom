/** Bounded backing stores; draw code keeps its logical coordinates when the cap is hit. */
export const MAX_PROP_TEXTURE = 1024;
export function canvasTextureSize(width: number, height: number) {
  const scale = Math.min(1, MAX_PROP_TEXTURE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// Compatibility export for existing chat/sign callers; there is one implementation.
export { canvasTextLines } from '../hud-diegetic';
