/**
 * Overview quick actions (HUD variant c): where "Go here" and a room click drop the player into first person.
 * Pure view math only: it moves a camera, never writes state, evaluates policy or calls a model.
 */
import { FLOOR, INTERACT_RANGE, PLAYER_RADIUS, SPAWN, insideAny, interactCandidates, pickTarget, type Box, type PlayEntry, type Vec2 } from './play';
import { destinationRect } from './layout';
import { AGENT_RADIUS } from './targets/agent';
import { OFFICE_ANCHORS, isAnchorId, type AnchorId, type OfficeSnapshot } from './state';

export type { PlayEntry };

/** What an Overview click picked. Agents and desks open the quick menu; a room floor jumps straight in. */
export type OverviewPick = { readonly kind: 'agent'; readonly id: string } | { readonly kind: 'room'; readonly room: AnchorId };

export interface FloorRect { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }
/** Logical station bounds follow the canonical layout, independent of physical walls. */
export function roomRect(room: AnchorId): FloorRect { return destinationRect(room); }
export function roomAtPoint([x, z]: Vec2, rooms: readonly AnchorId[] = Object.keys(OFFICE_ANCHORS) as AnchorId[]): AnchorId | null {
  return [...rooms].filter(room => { const r = roomRect(room); return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ; })
    .sort((a, b) => Math.hypot(x - OFFICE_ANCHORS[a].center[0], z - OFFICE_ANCHORS[a].center[1]) - Math.hypot(x - OFFICE_ANCHORS[b].center[0], z - OFFICE_ANCHORS[b].center[1]))[0] ?? null;
}

/** Yaw that looks from `from` toward `to`. */
export function yawToward(from: Vec2, to: Vec2): number {
  return Math.atan2(-(to[0] - from[0]), -(to[1] - from[1]));
}

function onFloor([x, z]: Vec2): boolean {
  return x >= FLOOR.minX + PLAYER_RADIUS && x <= FLOOR.maxX - PLAYER_RADIUS && z >= FLOOR.minZ + PLAYER_RADIUS && z <= FLOOR.maxZ - PLAYER_RADIUS;
}
/** Where a player may stand: on the floor and clear of every collider. */
export function standable(spot: Vec2, colliders: readonly Box[]): boolean {
  return onFloor(spot) && !insideAny(spot, colliders, PLAYER_RADIUS);
}

/** Ring offsets around a centre, nearest ring first, each ring starting from `startAngle` and alternating sides. */
function ring(center: Vec2, radii: readonly number[], startAngle: number, steps = 16): [number, number][] {
  const spots: [number, number][] = [];
  for (const radius of radii) {
    for (let i = 0; i < steps; i++) {
      const k = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
      const angle = startAngle + (k * Math.PI * 2) / steps;
      spots.push([center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius]);
    }
  }
  return spots;
}

/**
 * Entering a room: its entry point (anchor `position`, by the door or the desk front), or the nearest free spot
 * inside the room, facing the room's desk. The Treasury is locked, so it lands at the vault door outside.
 */
export function roomEntry(room: AnchorId, colliders: readonly Box[], avoid: readonly Vec2[] = []): PlayEntry {
  const { position, center } = OFFICE_ANCHORS[room];
  const rect = roomRect(room);
  const inside = (spot: Vec2) => room === 'treasury' || (spot[0] > rect.minX && spot[0] < rect.maxX && spot[1] > rect.minZ && spot[1] < rect.maxZ);
  // Agents are not solid, but landing inside one puts the camera in their head.
  const clear = (spot: Vec2) => avoid.every(other => Math.hypot(spot[0] - other[0], spot[1] - other[1]) >= AGENT_CLEARANCE);
  const start = Math.atan2(position[1] - center[1], position[0] - center[0]);
  const spot = [[position[0], position[1]] as [number, number], ...ring(position, [0.35, 0.6, 0.9, 1.2], start)]
    .find(candidate => inside(candidate) && clear(candidate) && standable(candidate, colliders));
  if (!spot) return { position: [SPAWN.position[0], SPAWN.position[1]], yaw: SPAWN.yaw };
  const look = Math.hypot(center[0] - spot[0], center[1] - spot[1]) > 0.3 ? yawToward(spot, center) : room === 'lobby' ? Math.PI / 2 : SPAWN.yaw;
  return { position: spot, yaw: look };
}

/** Closest a room entry lands to an agent's centre. */
export const AGENT_CLEARANCE = 0.8;
/** Distances from the agent: inside talk range (centre distance minus AGENT_RADIUS within INTERACT_RANGE) with a margin. */
const AGENT_RINGS = [1.35, 1.15, 0.95] as const;

/**
 * "Go here" for an agent: the nearest free spot beside them, inside the room they are in, facing them, from
 * which the first-person pick would offer "Talk to <name>". Searches the open side (toward the room's
 * entry) first. Falls back to the room entry when nothing qualifies.
 */
export function agentEntry(snapshot: OfficeSnapshot, agentId: string, agentPosition: Vec2, colliders: readonly Box[], rooms: readonly AnchorId[]): PlayEntry | null {
  const agent = snapshot.agents.find(row => row.id === agentId);
  if (!agent) return null;
  const here = roomAtPoint(agentPosition, rooms);
  const seat = isAnchorId(agent.seatId) ? agent.seatId : null;
  // Stand on the open side: away from the desk, so the agent is framed in front of it.
  const desk = OFFICE_ANCHORS[here ?? seat ?? 'lobby'].center;
  const start = Math.hypot(agentPosition[0] - desk[0], agentPosition[1] - desk[1]) > 0.2
    ? Math.atan2(agentPosition[1] - desk[1], agentPosition[0] - desk[0]) : Math.PI / 2;
  const rect = here ? roomRect(here) : null;
  const candidates = interactCandidates([{ id: agentId, position: agentPosition }], rooms);
  for (const spot of ring(agentPosition, AGENT_RINGS, start, 24)) {
    if (rect && !(spot[0] > rect.minX && spot[0] < rect.maxX && spot[1] > rect.minZ && spot[1] < rect.maxZ)) continue;
    if (!standable(spot, colliders)) continue;
    if (Math.hypot(spot[0] - agentPosition[0], spot[1] - agentPosition[1]) - AGENT_RADIUS > INTERACT_RANGE) continue;
    const yaw = yawToward(spot, agentPosition);
    const picked = pickTarget(spot, yaw, candidates);
    if (picked?.kind !== 'agent' || picked.id !== agentId) continue;
    return { position: spot, yaw };
  }
  const fallback = here ?? seat;
  return fallback ? roomEntry(fallback, colliders, [agentPosition]) : null;
}

/** The agent seated at a desk (for "Talk" from a desk's menu). */
export function seatedAgent(snapshot: OfficeSnapshot, room: AnchorId): string | null {
  return snapshot.agents.find(agent => agent.seatId === room)?.id ?? null;
}

/** Keys that toggle Overview and first person. Ignored while typing or with a modifier held. */
export function isOverviewKey(event: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'o' || event.key === 'O');
}

/** Pointer travel (px) beyond which a canvas click was an orbit drag, not a pick. */
export const CLICK_SLOP = 6;

/**
 * Whether Play records a movement/turn key as held input. Story mode owns ArrowLeft/ArrowRight (chapters) and an
 * Overview quick menu owns the arrows while it has focus; recording them would read as the viewer walking.
 */
export function playOwnsMoveKeys(owners: { readonly story: boolean; readonly menu: boolean }): boolean {
  return !owners.story && !owners.menu;
}
