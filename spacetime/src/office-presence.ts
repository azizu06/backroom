export const OFFICE_PRESENCE_LIMIT = 32n;
export const OFFICE_PRESENCE_RATE = 200n;
export const OFFICE_PRESENCE_TTL = 15_000n;
export const OFFICE_PRESENCE_SWEEP = 5_000_000n; // ScheduleAt intervals use microseconds.
const F32_PI = 3.141592502593994; // Largest f32 below pi; serialization must stay inside [-pi, pi].

export interface OfficePresenceInput { viewerId: string; name: string; x: number; z: number; yaw: number; mode: string }
export function validateViewerId(viewerId: string) {
  if (viewerId.length < 8 || viewerId.length > 64 || /[^A-Za-z0-9-]/.test(viewerId)) throw new Error('INVALID_VIEWER_ID');
}
/** Display data only. Time and ownership are supplied by the reducer context. */
export function normalizeOfficePresence(input: OfficePresenceInput): OfficePresenceInput {
  validateViewerId(input.viewerId);
  if (![input.x, input.z, input.yaw].every(Number.isFinite)) throw new Error('INVALID_PRESENCE_POSITION');
  if (!['overview', 'play', 'tour'].includes(input.mode)) throw new Error('INVALID_PRESENCE_MODE');
  return { viewerId: input.viewerId, name: input.name.replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().slice(0, 24) || 'Viewer',
    x: Math.max(-8, Math.min(8, input.x)), z: Math.max(-5.5, Math.min(5.5, input.z)),
    yaw: Math.max(-F32_PI, Math.min(F32_PI, Math.atan2(Math.sin(input.yaw), Math.cos(input.yaw)))), mode: input.mode };
}
