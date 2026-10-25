import { PATH } from './outdoors';

export const PEOPLE_COUNT = 4;
export const WALK_PERIOD = 90;
export const CAR_COUNT = 3;
export const CAR_PERIOD = 100;
export const RAIN_COUNT = 160;
export const RAIN_PERIOD = 4.5;
const TAU = Math.PI * 2;
const entranceX = (PATH.minX + PATH.maxX) / 2;
const wrap = (value: number, period: number) => ((value % period) + period) % period;

/** Two narrow entrance loops and two small garden loops, all clear of the building. */
export function personPosition(seconds: number, index: number, axis: 'x' | 'y' | 'z'): number {
  const angle = (seconds / WALK_PERIOD + index / PEOPLE_COUNT) * TAU;
  const onPath = index < 2;
  if (axis === 'y') return 0.025 + 0.035 * (1 - Math.cos(seconds * TAU * 1.5 + index));
  if (axis === 'x') return entranceX + (onPath ? 0 : index === 2 ? -9 : 9) + Math.cos(angle) * (onPath ? 0.42 : 3);
  return (onPath ? (PATH.minZ + PATH.maxZ) / 2 : PATH.minZ + 6) + Math.sin(angle) * (onPath ? (PATH.maxZ - PATH.minZ) / 2 - 2 : 3);
}

export function personHeading(seconds: number, index: number): number {
  const angle = (seconds / WALK_PERIOD + index / PEOPLE_COUNT) * TAU;
  return Math.atan2(-Math.sin(angle) * (index < 2 ? 0.42 : 3), Math.cos(angle) * (index < 2 ? (PATH.maxZ - PATH.minZ) / 2 - 2 : 3));
}

/** Wrap beyond the grounds' edge; the cubic track slows smoothly at the entrance. */
export function carPosition(seconds: number, index: number, axis: 'x' | 'z'): number {
  const direction = index === 1 ? -1 : 1;
  const u = wrap(seconds / CAR_PERIOD + index / CAR_COUNT, 1) * 2 - 1;
  return axis === 'x' ? direction * 120 * (0.4 * u + 0.6 * u * u * u)
    : PATH.maxZ + 3.5 + direction * 1.35;
}

/** Sparse deterministic columns; none fall through the office roof or its interior. */
export function rainPosition(seconds: number, index: number, axis: 'x' | 'y' | 'z'): number {
  if (axis === 'y') return 0.4 + 18 * (1 - wrap(seconds / RAIN_PERIOD + index * 0.61803398875, 1));
  const angle = index * 2.3999632297;
  const radius = 22 + (index % 13) * 2;
  return axis === 'x' ? Math.cos(angle) * radius : Math.sin(angle) * radius;
}
