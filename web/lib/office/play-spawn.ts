import { FLOOR, PLAYER_RADIUS, SPAWN, insideAny, type Box, type Vec2 } from "./play";

/**
 * Test-only Play spawn from `?playSpawn=x,z` (browser specs place viewers apart without walking).
 * Clamped to the floor; falls back to the lobby spawn when malformed or inside a collider.
 */
export function playSpawn(search: string, colliders: readonly Box[]): [number, number] {
  const fallback: [number, number] = [SPAWN.position[0], SPAWN.position[1]];
  const raw = new URLSearchParams(search).get("playSpawn");
  if (!raw) return fallback;
  const parts = raw.split(",").map(part => (part.trim() ? Number(part) : NaN));
  if (parts.length !== 2 || !parts.every(Number.isFinite)) return fallback;
  const clamp = (value: number, min: number, max: number) => Math.min(max - PLAYER_RADIUS, Math.max(min + PLAYER_RADIUS, value));
  const spot: Vec2 = [clamp(parts[0]!, FLOOR.minX, FLOOR.maxX), clamp(parts[1]!, FLOOR.minZ, FLOOR.maxZ)];
  return insideAny(spot, colliders, PLAYER_RADIUS) ? fallback : [spot[0], spot[1]];
}
