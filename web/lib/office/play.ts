/**
 * Pure first-person "Play" helpers for the office view. Visual only: walking, looking and
 * inspecting never write state, evaluate policy or call a model. Panel data comes from the snapshot.
 */
import { DEFAULT_FEEL, bobHeight, type FeelFlags } from "./playFeel";
import { OFFICE_ANCHORS, type AnchorId, type OfficeSnapshot } from "./state";
import { PLAY_TARGET_LIST, playTargetModule, type PlayTarget } from "./targets";
import { AGENT_RADIUS } from "./targets/agent";
import { DESKS, DESK_RADIUS, DESK_SIZE } from "./targets/desk";
import { PAYLINK_KIOSK, PAYLINK_RADIUS } from "./targets/paylink";
import { SERVER_ROOM } from "./targets/server";
import { DOOR_RADIUS, TREASURY_DOOR } from "./targets/treasury";
import type { CoworkerSpot, HandoffResolver, PlayPanelEntry, PlayPanelOf, Vec2 } from "./targets/types";

// Interact radii and positions live with their Play target modules (./targets); re-exported for callers.
export { AGENT_RADIUS, DESK_RADIUS, DESK_SIZE, DOOR_RADIUS, PAYLINK_KIOSK, PAYLINK_RADIUS, SERVER_ROOM, TREASURY_DOOR };
export type { CoworkerSpot, PlayPanelEntry, PlayTarget, Vec2 };

export const EYE_HEIGHT = 1.55;
export const WALK_SPEED = 3;
export const TURN_SPEED = 2.2;
export const PLAYER_RADIUS = 0.28;
/**
 * Interact reach, measured from the eye to the edge of the thing (its centre distance minus its radius).
 * 1.1 m: arm's length plus a step. It has to stay below 1.2 so the Treasury door (radius 0.65) is not
 * offered from (5, 3.0) inside the locked vault, 1.85 m from the door centre. From where colliders stop
 * you (PLAYER_RADIUS 0.28) every target is well inside it: the door barrier stops you 0.38 m from the
 * door centre and agents are not solid. A desk prompt starts 1.1 m from its front edge and 0.5 m from
 * its ends; from across the aisle (about 2.5 m away) nothing is offered.
 */
export const INTERACT_RANGE = 1.1;
/** Half-angle of the pick cone in radians; widened up close (see pickTarget) so you keep what you stand at. */
export const PICK_CONE = 0.35;
export const PITCH_LIMIT = 1.2;
export const LOOK_SENSITIVITY = 0.0025;
/** Lobby aisle, facing -z toward the Collections desk. */
export const SPAWN = { position: [-5, 0.9] as const, yaw: 0 } as const;
export const FLOOR = { minX: -8, maxX: 8, minZ: -5.5, maxZ: 5.5 } as const;
export interface Box { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }

/** Camera convention: yaw 0 looks toward -z. */
export function forwardOf(yaw: number): [number, number] { return [-Math.sin(yaw), -Math.cos(yaw)]; }
export function rightOf(yaw: number): [number, number] { return [Math.cos(yaw), -Math.sin(yaw)]; }

function box(x: number, z: number, width: number, depth: number): Box {
  return { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
}
export const SERVER_ROOM_BOX: Box = box(SERVER_ROOM.position[0], SERVER_ROOM.position[1], SERVER_ROOM.size.width, SERVER_ROOM.size.depth);
const DOORS = ["collections", "payables", "vendor_onboarding"] as const satisfies readonly AnchorId[];

/**
 * Solid footprints mirroring the layout drawn in web/app/office/scene.tsx and its mounts (web/app/office/mounts:
 * Desks, Doors, Plants, LobbyCounter, TreasuryVault). Keep in sync with those files. The Treasury is locked: its doorway is closed by a barrier.
 * `extra` takes footprints of room geometry mounted elsewhere (e.g. a self-contained room at an anchor),
 * so new furniture becomes solid without editing this list.
 */
export function officeColliders(rooms: readonly AnchorId[], extra: readonly Box[] = []): Box[] {
  const visible = new Set(rooms);
  const boxes: Box[] = [...extra];
  for (const x of [-2.5, 2.5]) boxes.push(box(x, -3.15, 0.12, 4.6), box(x, 3.5, 0.12, 3.8));
  for (const room of DESKS) {
    if (!visible.has(room)) continue;
    const [x, z] = OFFICE_ANCHORS[room].center;
    // Dana's desk group is rotated by PI, which mirrors the chair offset.
    const facing = room === "dana" ? -1 : 1;
    boxes.push(box(x, z, DESK_SIZE.width, DESK_SIZE.depth), box(x + 0.05 * facing, z - 0.9 * facing, 0.65, 0.6));
  }
  for (const room of DOORS) {
    if (!visible.has(room)) continue;
    const [x] = OFFICE_ANCHORS[room].center;
    boxes.push(box(x - 0.72, -0.65, 0.14, 0.18), box(x + 0.72, -0.65, 0.14, 0.18));
  }
  if (visible.has("treasury")) {
    const [x] = OFFICE_ANCHORS.treasury.center;
    boxes.push(box(5, 4, 1.8, 1.25), box(x - 0.72, TREASURY_DOOR[1], 0.14, 0.18), box(x + 0.72, TREASURY_DOOR[1], 0.14, 0.18));
    // Locked door: no gap between it and the x=2.5 partition, so the vault is unreachable.
    boxes.push({ minX: 2.44, maxX: FLOOR.maxX, minZ: 1.05, maxZ: 1.6 });
  }
  if (visible.has("lobby")) boxes.push(box(-5.9, 3.9, 2, 0.15), box(-4.4, 3.1, 0.8, 1));
  for (const [x, z] of [[-7.1, -4.6], [7.1, -4.6], [1.7, 4.5]] as const) boxes.push(box(x, z, 1, 1));
  return boxes;
}

const EPS = 1e-4;
export function insideAny(position: Vec2, colliders: readonly Box[], radius: number): boolean {
  return colliders.some(c => position[0] > c.minX - radius && position[0] < c.maxX + radius
    && position[1] > c.minZ - radius && position[1] < c.maxZ + radius);
}
function sweep(from: number, delta: number, other: number, colliders: readonly Box[], radius: number, axis: 0 | 1): number {
  let to = from + delta;
  if (!delta) return to;
  for (const c of colliders) {
    const [lo, hi, oLo, oHi] = axis === 0 ? [c.minX, c.maxX, c.minZ, c.maxZ] : [c.minZ, c.maxZ, c.minX, c.maxX];
    if (other <= oLo - radius || other >= oHi + radius) continue;
    if (delta > 0 && lo - radius >= from - EPS && lo - radius < to) to = lo - radius - EPS;
    if (delta < 0 && hi + radius <= from + EPS && hi + radius > to) to = hi + radius + EPS;
  }
  return to;
}
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }

/**
 * Axis-separated move (x then z) so the player slides along walls; never ends inside a new collider.
 * A box that already overlaps the player (e.g. a room that became visible on top of them) does not
 * block, so the player can always walk out of it.
 */
export function movePlayer(position: Vec2, step: Vec2, colliders: readonly Box[], radius = PLAYER_RADIUS): [number, number] {
  const x = clamp(sweep(position[0], step[0], position[1], colliders, radius, 0), FLOOR.minX + radius, FLOOR.maxX - radius);
  const z = clamp(sweep(position[1], step[1], x, colliders, radius, 1), FLOOR.minZ + radius, FLOOR.maxZ - radius);
  const blocking = colliders.filter(box => !insideAny(position, [box], radius));
  return insideAny([x, z], blocking, radius) ? [position[0], position[1]] : [x, z];
}

export type PlayControl = "forward" | "back" | "left" | "right" | "turnLeft" | "turnRight";
/** Mutable input shared by the HUD (initial bundle) and the rig (lazy scene). */
export class PlayInput {
  readonly held = new Set<PlayControl>();
  /** x = strafe right, y = forward, each in [-1, 1]. */
  readonly joystick: [number, number] = [0, 0];
  lookYaw = 0;
  lookPitch = 0;
  /** Walking speed multiplier from the viewer's Play settings. */
  speed = 1;
  /** Game-feel switches from the viewer's Play settings; the rig also applies reduced motion. */
  feel: FeelFlags = DEFAULT_FEEL;
  press(control: PlayControl) { this.held.add(control); }
  release(control: PlayControl) { this.held.delete(control); }
  setJoystick(x: number, y: number) {
    const length = Math.hypot(x, y);
    const scale = length > 1 ? 1 / length : 1;
    this.joystick[0] = clamp(x * scale, -1, 1) || 0;
    this.joystick[1] = clamp(y * scale, -1, 1) || 0;
  }
  look(dYaw: number, dPitch: number) { this.lookYaw += dYaw; this.lookPitch += dPitch; }
  consumeLook(): [number, number] {
    const look: [number, number] = [this.lookYaw, this.lookPitch];
    this.lookYaw = 0;
    this.lookPitch = 0;
    return look;
  }
  clear() { this.held.clear(); this.setJoystick(0, 0); this.consumeLook(); }
  active() { return this.held.size > 0 || this.joystick[0] !== 0 || this.joystick[1] !== 0 || this.lookYaw !== 0 || this.lookPitch !== 0; }
}

/** World-space step for this frame from held keys and the joystick. */
export function moveIntent(input: PlayInput, yaw: number, dt: number): [number, number] {
  const ahead = (input.held.has("forward") ? 1 : 0) - (input.held.has("back") ? 1 : 0) + input.joystick[1];
  const side = (input.held.has("right") ? 1 : 0) - (input.held.has("left") ? 1 : 0) + input.joystick[0];
  const length = Math.hypot(ahead, side);
  if (!length || dt <= 0) return [0, 0];
  const scale = Math.min(1, 1 / length) * WALK_SPEED * input.speed * dt;
  const [fx, fz] = forwardOf(yaw), [rx, rz] = rightOf(yaw);
  return [(fx * ahead + rx * side) * scale, (fz * ahead + rz * side) * scale];
}
/** Yaw change from the turn keys; turning left increases yaw. */
export function turnIntent(input: PlayInput, dt: number): number {
  return ((input.held.has("turnLeft") ? 1 : 0) - (input.held.has("turnRight") ? 1 : 0)) * TURN_SPEED * Math.max(dt, 0);
}
export function applyLook(yaw: number, pitch: number, dYaw: number, dPitch: number): { yaw: number; pitch: number } {
  const next = Math.atan2(Math.sin(yaw + dYaw), Math.cos(yaw + dYaw));
  return { yaw: next, pitch: clamp(pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT) };
}

export interface PlayCandidate { readonly target: PlayTarget; readonly position: Vec2; readonly radius: number }
export function targetKey(target: PlayTarget | null): string {
  if (!target) return "";
  return playTargetModule(target.kind).key?.(target) ?? target.kind;
}

/**
 * Every registered target's candidates, in registry order (./targets): agents at their drawn (motion) positions,
 * handoff agents, each visible desk at its room centre, the Treasury door, the lobby payment kiosk, the GX10 server and coworkers.
 */
export function interactCandidates(agents: readonly { id: string; position: Vec2 }[], rooms: readonly AnchorId[], handoffAgents: readonly { id: string; position: Vec2 }[] = [], coworkers: readonly CoworkerSpot[] = []): PlayCandidate[] {
  const context = { agents, visible: new Set(rooms), handoffAgents, coworkers };
  return PLAY_TARGET_LIST.flatMap(target => [...target.candidates(context)]);
}

/**
 * Nearest candidate within range (radius extends the range) whose bearing is inside the view cone; agents win ties.
 * Up close the cone widens to the candidate's angular size (asin(radius / distance)), so a target stays
 * picked while the crosshair is anywhere on it.
 */
export function pickTarget(eye: Vec2, yaw: number, candidates: readonly PlayCandidate[], range = INTERACT_RANGE, cone = PICK_CONE): PlayTarget | null {
  const [fx, fz] = forwardOf(yaw);
  let best: { target: PlayTarget; distance: number } | null = null;
  for (const candidate of candidates) {
    const dx = candidate.position[0] - eye[0], dz = candidate.position[1] - eye[1];
    const distance = Math.hypot(dx, dz);
    if (distance - candidate.radius > range) continue;
    if (distance > 1e-6) {
      const bearing = Math.acos(clamp((dx * fx + dz * fz) / distance, -1, 1));
      if (bearing > Math.max(cone, Math.asin(Math.min(1, candidate.radius / distance)))) continue;
    }
    const agent = candidate.target.kind === "agent";
    if (!best || distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) <= 1e-9 && agent && best.target.kind !== "agent")) {
      best = { target: candidate.target, distance };
    }
  }
  return best?.target ?? null;
}

export function headBob(distance: number, moving: boolean, reduced: boolean): number {
  return reduced || !moving ? 0 : bobHeight(distance, 1);
}

export type PlayPanel = PlayPanelOf<PlayTarget["kind"]>;

/** Display data for the interaction panel (from the target's registry module); null when the target is no longer in the snapshot. */
export function playPanel(snapshot: OfficeSnapshot, target: PlayTarget, handoffFor?: HandoffResolver): PlayPanel | null {
  return playTargetModule(target.kind).panel(snapshot, target, handoffFor);
}

export function targetLabel(snapshot: OfficeSnapshot, target: PlayTarget): string {
  return playTargetModule(target.kind).label(snapshot, target);
}

/** What the lazy scene needs from Office to run Play; `hud` receives data-player-* attributes. */
export interface PlayBridge {
  readonly input: PlayInput;
  readonly onTarget: (target: PlayTarget | null) => void;
  readonly hud: { readonly current: HTMLElement | null };
  /** Other viewers in Play (soft targets), read on each rig frame. */
  readonly coworkers?: { readonly current: readonly CoworkerSpot[] };
}
