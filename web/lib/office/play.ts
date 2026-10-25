/**
 * Pure first-person "Play" helpers for the office view. Visual only: walking, looking and
 * inspecting never write state, evaluate policy or call a model. Panel data comes from the snapshot.
 */
import { DEFAULT_FEEL, bobHeight, type FeelFlags } from "./playFeel";
import { OPEN_DOORS, type DoorState } from './doors';
import { CHAIR_FOOTPRINT, PLANT_SPOTS } from './furniture';
import { TREASURY_VAULT } from './deskkit';
import { AUDIT_WALL } from './props/auditWall';
import { WHITEBOARD, WHITEBOARD_INTERACTION } from './props/whiteboard';
import { OFFICE_ANCHORS, type AnchorId, type OfficeSnapshot } from "./state";
import { PLAY_TARGET_LIST, playTargetModule, type PlayTarget } from "./targets";
import { AGENT_RADIUS } from "./targets/agent";
import { DESKS, DESK_RADIUS, DESK_SIZE } from "./targets/desk";
import { PAYLINK_KIOSK, PAYLINK_RADIUS } from "./targets/paylink";
import { SERVER_ROOM } from "./targets/server";
import { DOOR_RADIUS, TREASURY_DOOR } from "./targets/treasury";
import { PHONE_STAND } from "./props/phone";
import { WORKSTATIONS, BUILDING, LOBBY_BOARD_MOUNT, ROOM_SPAWNS, WALL_THICKNESS, wallColliders } from "./layout";
import type { CoworkerSpot, HandoffResolver, PlayCandidateOf, PlayPanelEntry, PlayPanelOf, Vec2 } from "./targets/types";

// Interact radii and positions live with their Play target modules (./targets); re-exported for callers.
export { AGENT_RADIUS, DESK_RADIUS, DESK_SIZE, DOOR_RADIUS, PAYLINK_KIOSK, PAYLINK_RADIUS, SERVER_ROOM, TREASURY_DOOR };
export type { CoworkerSpot, PlayPanelEntry, PlayTarget, Vec2 };

export const EYE_HEIGHT = 1.55;
export const WALK_SPEED = 3;
export const TURN_SPEED = 2.2;
export const PLAYER_RADIUS = 0.28;
/**
 * Interact reach, measured from the eye to the edge of the thing (its centre distance minus its radius).
 * 1.1 m: arm's length plus a step. From where colliders stop
 * you (PLAYER_RADIUS 0.28) every target is well inside it: the door barrier stops you 0.38 m from the
 * door centre and agents are not solid. A desk prompt starts 1.1 m from its front edge and 0.5 m from
 * its ends; from across the aisle (about 2.5 m away) nothing is offered.
 */
export const INTERACT_RANGE = 1.1;
/** Half-angle of the pick cone in radians; widened up close (see pickTarget) so you keep what you stand at. */
export const PICK_CONE = 0.35;
export const PITCH_LIMIT = 1.2;
export const LOOK_SENSITIVITY = 0.0025;
/** Corridor outside the lobby, facing -z through the open Collections door toward its desk. */
export const SPAWN = ROOM_SPAWNS.corridor;
/** Walkable floor: inside the building's outer walls (./layout), whose faces are also colliders. */
export const FLOOR = {
  minX: BUILDING.minX + WALL_THICKNESS / 2, maxX: BUILDING.maxX - WALL_THICKNESS / 2,
  minZ: BUILDING.minZ + WALL_THICKNESS / 2, maxZ: BUILDING.maxZ - WALL_THICKNESS / 2,
} as const;
export interface Box { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number }

/** Camera convention: yaw 0 looks toward -z. */
export function forwardOf(yaw: number): [number, number] { return [-Math.sin(yaw), -Math.cos(yaw)]; }
export function rightOf(yaw: number): [number, number] { return [Math.cos(yaw), -Math.sin(yaw)]; }

function box(x: number, z: number, width: number, depth: number): Box {
  return { minX: x - width / 2, maxX: x + width / 2, minZ: z - depth / 2, maxZ: z + depth / 2 };
}
export const SERVER_ROOM_BOX: Box = box(SERVER_ROOM.position[0], SERVER_ROOM.position[1], SERVER_ROOM.size.width, SERVER_ROOM.size.depth);

/**
 * Solid footprints mirroring the layout drawn in web/app/office/scene.tsx and its mounts (web/app/office/mounts:
 * WorldShell, Desks, Plants, LobbyCounter, TreasuryVault). Walls come from ./layout, so a
 * workstation footprint and chair are shared with the rendered pods; only the vault itself is solid.
 * `extra` takes footprints of room geometry mounted elsewhere (e.g. a self-contained room at an anchor),
 * so new furniture becomes solid without editing this list.
 */
export function officeColliders(rooms: readonly AnchorId[], extra: readonly Box[] = [], _doors: DoorState = OPEN_DOORS): Box[] {
  const visible = new Set(rooms);
  const chair = CHAIR_FOOTPRINT;
  const boxes: Box[] = [...extra, ...wallColliders(), ...WORKSTATIONS.flatMap(({ center: [x, z], flip }) => [box(x, z, DESK_SIZE.width, DESK_SIZE.depth), box(x + chair.x * flip, z + chair.z * flip, chair.width, chair.depth)])];
  for (const room of DESKS) {
    if (!visible.has(room)) continue;
    if (room === "collections") boxes.push(box(PHONE_STAND.x, PHONE_STAND.z, PHONE_STAND.width, PHONE_STAND.depth));
  }
  if (visible.has("treasury")) {
    // Include the frame and projecting handle in both procedural and opt-in kit modes.
    boxes.push(box(TREASURY_VAULT.x, TREASURY_VAULT.z - 0.065, 1.84, 1.42));
  }
  if (visible.has("lobby")) {
    const board = LOBBY_BOARD_MOUNT;
    boxes.push(box(board.x, board.z, board.width, board.depth), box(PAYLINK_KIOSK[0], PAYLINK_KIOSK[1], 0.8, 1),
      box(AUDIT_WALL.x, AUDIT_WALL.z, 0.06, AUDIT_WALL.width));
  }
  if (visible.has("payables")) {
    const wallFace = BUILDING.minZ + WALL_THICKNESS / 2;
    boxes.push(box(WHITEBOARD_INTERACTION.position[0], wallFace + WHITEBOARD.depth / 2, WHITEBOARD.width, WHITEBOARD.depth));
    // Marker tray projects farther than the frame, at eye/body height.
    boxes.push(box(WHITEBOARD_INTERACTION.position[0], wallFace + WHITEBOARD.depth / 2 + 0.07, 1.1, 0.14));
  }
  for (const [x, z] of PLANT_SPOTS) boxes.push(box(x, z, 1, 1));
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
  /** Yaw queued by a turn-key tap. Applied on the next frame only if that key is no longer held. */
  turnTap = 0;
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
  clear() { this.held.clear(); this.setJoystick(0, 0); this.consumeLook(); this.turnTap = 0; }
  consumeTurnTap(): number {
    const tap = this.turnTap;
    this.turnTap = 0;
    return tap;
  }
  active() { return this.held.size > 0 || this.joystick[0] !== 0 || this.joystick[1] !== 0 || this.lookYaw !== 0 || this.lookPitch !== 0 || this.turnTap !== 0; }
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
/**
 * Queue one display frame of yaw for a turn-key tap (left positive, matching turnIntent).
 * useFrame only samples keys that are still held, so a tap released before that frame would not turn.
 */
export function applyTurnTap(input: PlayInput, control: PlayControl): void {
  if (control === "turnLeft") input.turnTap += TURN_SPEED / 60;
  else if (control === "turnRight") input.turnTap -= TURN_SPEED / 60;
}
/** Mouse look plus either the held turn keys or a queued tap, never both (a keydown queues a tap and also holds the key). */
export function frameLookYaw(lookYaw: number, keyed: number, tap: number): number {
  return lookYaw + (keyed !== 0 ? keyed : tap);
}
export function applyLook(yaw: number, pitch: number, dYaw: number, dPitch: number): { yaw: number; pitch: number } {
  const next = Math.atan2(Math.sin(yaw + dYaw), Math.cos(yaw + dYaw));
  return { yaw: next, pitch: clamp(pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT) };
}

export type PlayCandidate = PlayCandidateOf<PlayTarget>;
export function targetKey(target: PlayTarget | null): string {
  if (!target) return "";
  return playTargetModule(target.kind).key?.(target) ?? target.kind;
}

/**
 * Every registered target's candidates, in registry order (./targets): agents at their drawn (motion) positions,
 * handoff agents, each visible desk at its room centre, the Treasury door, the lobby payment kiosk, the GX10 server and coworkers.
 */
export function interactCandidates(agents: readonly { id: string; position: Vec2 }[], rooms: readonly AnchorId[], coworkers: readonly CoworkerSpot[] = [], handoffAgents: readonly { id: string; position: Vec2 }[] = []): PlayCandidate[] {
  const context = { agents, visible: new Set(rooms), handoffAgents, coworkers };
  return PLAY_TARGET_LIST.flatMap(target => [...target.candidates(context)]);
}

/**
 * Nearest candidate within range (radius extends the range) whose bearing is inside the view cone.
 * A desk's general inspect prompt yields to an eligible agent (including handoff actors); other targets still compete by distance.
 * Up close the cone widens to the candidate's angular size (asin(radius / distance)), so a target stays
 * picked while the crosshair is anywhere on it. Open doors require facing the swung leaf. Open leaves
 * yield to other targets; closed leaves compete by distance so targets behind them cannot take priority.
 */
export function pickTarget(eye: Vec2, yaw: number, candidates: readonly PlayCandidate[], range = INTERACT_RANGE, cone = PICK_CONE): PlayTarget | null {
  const [fx, fz] = forwardOf(yaw);
  let best: { target: PlayTarget; distance: number } | null = null;
  let nonDesk: { target: PlayTarget; distance: number } | null = null;
  let door: { target: PlayTarget; distance: number } | null = null;
  for (const candidate of candidates) {
    const dx = candidate.position[0] - eye[0], dz = candidate.position[1] - eye[1];
    const distance = Math.hypot(dx, dz);
    if (distance - candidate.radius > range) continue;
    if (distance > 1e-6) {
      const bearing = Math.acos(clamp((dx * fx + dz * fz) / distance, -1, 1));
      const pickCone = candidate.target.kind === "door" && !candidate.blocksInteraction ? cone : Math.max(cone, Math.asin(Math.min(1, candidate.radius / distance)));
      if (bearing > pickCone) continue;
    }
    if (candidate.target.kind === "door" && !candidate.blocksInteraction) {
      if (!door || distance < door.distance) door = { target: candidate.target, distance };
      continue;
    }
    const agent = candidate.target.kind === "agent";
    if (!best || distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) <= 1e-9 && agent && best.target.kind !== "agent")) {
      best = { target: candidate.target, distance };
    }
    if (candidate.target.kind !== "desk" && (!nonDesk || distance < nonDesk.distance - 1e-9 || (Math.abs(distance - nonDesk.distance) <= 1e-9 && agent && nonDesk.target.kind !== "agent"))) {
      nonDesk = { target: candidate.target, distance };
    }
  }
  if (best?.target.kind === "desk" && (nonDesk?.target.kind === "agent" || nonDesk?.target.kind === "handoff")) return nonDesk.target;
  return best?.target ?? door?.target ?? null;
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
  /** A Story mode stop temporarily owns this same first-person rig. */
  readonly story?: import('./story').StoryChapter;
  readonly input: PlayInput;
  readonly onTarget: (target: PlayTarget | null) => void;
  readonly hud: { readonly current: HTMLElement | null };
  /** Other viewers in Play (soft targets), read on each rig frame. */
  readonly coworkers?: { readonly current: readonly CoworkerSpot[] };
  /** Where the next Play session starts (Overview "Go here" / room jump); read once when the rig mounts, then cleared. */
  readonly entry?: { current: PlayEntry | null };
  /** The pose the last Play session ended at, so toggling Overview and back resumes there. */
  readonly last?: { current: PlayEntry | null };
}
/** A first-person entry: floor position and yaw (yaw 0 looks toward -z). */
export interface PlayEntry { readonly position: readonly [x: number, z: number]; readonly yaw: number }
