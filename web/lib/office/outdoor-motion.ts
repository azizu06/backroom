import { BUILDING, WALLS, WINDOWS } from './layout';

export const OUTDOOR_FPS = 12;
export const CLOUD_COUNT = 4;
export const BIRD_COUNT = 5;
export const CLOUD_PERIOD = 900;
export const BIRD_PERIOD = 120;
const WINDOW_POINTS = WINDOWS.map(window => {
  const wall = WALLS.find(wall => wall.id === window.wall)!;
  return { axis: wall.axis, fixed: wall.fixed, at: window.at, width: window.width };
});

/** Small, spatially dephased rotations in radians; no vertex deformation. */
export function outdoorSway(seconds: number, seed: number): number {
  return 0.018 * Math.sin(seconds * 0.65 + seed) + 0.007 * Math.sin(seconds * 0.31 + seed * 1.7);
}

/** Clouds orbit slowly, avoiding a visible teleport when a wrapped track resets. */
export function cloudPosition(seconds: number, index: number, axis: 'x' | 'y' | 'z'): number {
  const angle = seconds * Math.PI * 2 / CLOUD_PERIOD + index * Math.PI / 2;
  return axis === 'x' ? Math.cos(angle) * 105 : axis === 'z' ? Math.sin(angle) * 95 : 38 + index * 5;
}

export function birdHeading(seconds: number): number {
  return seconds * Math.PI * 2 / BIRD_PERIOD;
}

/** A tight V formation on a closed ellipse, high above the north garden. */
export function birdPosition(seconds: number, index: number, axis: 'x' | 'y' | 'z'): number {
  const angle = birdHeading(seconds), row = Math.ceil(index / 2);
  const side = index === 0 ? 0 : (index % 2 ? -1 : 1) * row * 1.3;
  return axis === 'x' ? Math.sin(angle) * 32 + side * Math.cos(angle) - row * Math.sin(angle)
    : axis === 'z' ? -28 + Math.cos(angle) * 24 - side * Math.sin(angle) - row * Math.cos(angle)
      : 21 + Math.sin(angle * 2) * 0.8 + row * 0.25;
}

/** A ten-minute daylight cycle: interpolation only between bright palette tokens. */
export function daylightBlend(seconds: number): number {
  return (1 - Math.cos(seconds * Math.PI * 2 / 600)) * 0.5;
}

/** Conservative visibility gate: overview, outside, or within 3 m of an actual window. */
export function outdoorMotionVisible(overview: boolean, x: number, z: number): boolean {
  if (overview || x < BUILDING.minX || x > BUILDING.maxX || z < BUILDING.minZ || z > BUILDING.maxZ) return true;
  for (const window of WINDOW_POINTS) {
    const across = window.axis === 'x' ? z : x, along = window.axis === 'x' ? x : z;
    if (Math.abs(across - window.fixed) <= 3 && Math.abs(along - window.at) <= window.width / 2 + 1.5) return true;
  }
  return false;
}
