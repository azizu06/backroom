/**
 * Procedural agent body language: which motion an agent bear is in (idle, walk, type, talk, greet,
 * think) and the pose for that motion at a given time. Pure and three-free so it is testable and stays
 * out of the initial bundle; the scene's animator (app/office/avatars/agentAnimator.ts) applies it.
 * View only: cues come from the Play HUD (E on an agent, a talk question) and never touch office state.
 */
import { requestSceneFrame } from './frame';
import { OFFICE_ANCHORS, isAnchorId } from './state';
import { DESKS } from './targets/desk';

export type AgentMode = 'idle' | 'walk' | 'type' | 'talk' | 'greet' | 'think';
/** Wave plus nod after the player presses E on the agent. */
export const GREET_MS = 1400;
/** Thinking beat after the player asks a question, before the agent settles back into talking. */
export const THINK_MS = 1100;
/** Head turns toward a first-person player within this many metres. */
export const LOOK_RANGE = 3;
/** Furthest the head turns from the body (radians). */
export const HEAD_YAW_LIMIT = 1.1;
/** Within this of their seat (metres) a stopped agent counts as at the desk. */
const SEATED = 0.05;

/** Viewer-local cues for one agent. Times are performance.now() ms; -Infinity means never. */
export interface AgentCue { greetAt: number; thinkAt: number; talking: boolean }

/** Priority: walking beats everything, then the short greet and think beats, then talking, typing, idle. Positional so a frame allocates nothing. */
export function agentMode(moving: boolean, atDesk: boolean, cue: AgentCue | undefined, now: number): AgentMode {
  if (moving) return 'walk';
  if (cue) {
    const greet = now - cue.greetAt, think = now - cue.thinkAt;
    if (greet >= 0 && greet < GREET_MS) return 'greet';
    if (think >= 0 && think < THINK_MS) return 'think';
    if (cue.talking) return 'talk';
  }
  return atDesk ? 'type' : 'idle';
}
/** Greet and think are timed beats: they need frames until they end even when nothing else moves. */
export function transientMode(mode: AgentMode): boolean {
  return mode === 'greet' || mode === 'think';
}
/** Modes where the agent turns its whole body to the player. */
export function facesPlayer(mode: AgentMode): boolean {
  return mode === 'greet' || mode === 'think' || mode === 'talk';
}

/** Cue keys match the Play target keys (`agent:<id>`, `handoff:<actor>`). */
export const agentCueKey = (id: string) => `agent:${id}`;
export const handoffCueKey = (actor: string) => `handoff:${actor}`;
/** The cue key for a Play target or talk speaker tag, or null when it is not an agent. */
export function cueKeyFor(target: { readonly kind: string; readonly id?: unknown; readonly actor?: unknown }): string | null {
  if (target.kind === 'agent' && typeof target.id === 'string') return agentCueKey(target.id);
  if (target.kind === 'handoff' && typeof target.actor === 'string') return handoffCueKey(target.actor);
  return null;
}

export function createAgentCues(wake: () => void = requestSceneFrame) {
  const cues = new Map<string, AgentCue>();
  let talking: string | null = null;
  const entry = (key: string) => {
    let cue = cues.get(key);
    if (!cue) cues.set(key, cue = { greetAt: -Infinity, thinkAt: -Infinity, talking: false });
    return cue;
  };
  return {
    get: (key: string): AgentCue | undefined => cues.get(key),
    greet(key: string, now = performance.now()) { entry(key).greetAt = now; wake(); },
    think(key: string, now = performance.now()) { entry(key).thinkAt = now; wake(); },
    /** One conversation at a time; null ends it. */
    setTalking(key: string | null) {
      if (key === talking) return;
      if (talking) entry(talking).talking = false;
      talking = key;
      if (key) entry(key).talking = true;
      wake();
    },
    clear() { cues.clear(); talking = null; },
  };
}
export const agentCues = createAgentCues();

/** Heading (WalkMotion convention, atan2(dx, dz)) from a seated agent to its desk, or NaN when not seated at one. */
export function deskHeading(seatId: string, x: number, z: number): number {
  if (!isAnchorId(seatId) || !(DESKS as readonly string[]).includes(seatId)) return NaN;
  const { position, center } = OFFICE_ANCHORS[seatId];
  if (Math.hypot(position[0] - x, position[1] - z) > SEATED) return NaN;
  return Math.atan2(center[0] - x, center[1] - z);
}
/** Shortest signed angle from `from` to `to`, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  const d = (to - from + Math.PI) % (Math.PI * 2);
  return (d < 0 ? d + Math.PI * 2 : d) - Math.PI;
}
/** Frame-rate independent ease of `current` toward `target` at `rate` per second. */
export function damp(current: number, target: number, rate: number, delta: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * Math.min(Math.max(delta, 0), 0.1)));
}
/**
 * Head yaw (relative to the body) that looks at the player, clamped to the neck limit, or 0 when the
 * player is further than `range` or not in first person (NaN position).
 */
export function lookYaw(bodyYaw: number, x: number, z: number, playerX: number, playerZ: number, range = LOOK_RANGE): number {
  const dx = playerX - x, dz = playerZ - z;
  if (!Number.isFinite(dx) || !Number.isFinite(dz) || Math.hypot(dx, dz) > range) return 0;
  return Math.max(-HEAD_YAW_LIMIT, Math.min(HEAD_YAW_LIMIT, angleDelta(bodyYaw, Math.atan2(dx, dz))));
}

/** One arm: `pitch` is rotation.x (negative swings the paw forward), `roll` is rotation.z as applied. */
export interface ArmOut { pitch: number; roll: number; active: boolean }
/** Mutable pose filled in place each frame (no allocations). Head yaw is the animator's (it is smoothed). */
export interface AgentPose {
  mode: AgentMode;
  /** Root lift (metres), forward lean (rotation.x) and side sway (rotation.z). */
  bob: number; lean: number; sway: number;
  /** Chest scale offset. */
  breath: number;
  headPitch: number; headTilt: number;
  /** [left, right]; inactive arms keep the walk swing / carry pose from poseBear. */
  readonly arms: [ArmOut, ArmOut];
}
export function createAgentPose(): AgentPose {
  return { mode: 'idle', bob: 0, lean: 0, sway: 0, breath: 0, headPitch: 0, headTilt: 0,
    arms: [{ pitch: 0, roll: 0, active: false }, { pitch: 0, roll: 0, active: false }] };
}
/** Which paws are free: a 'paw' carry holds the right one, 'front' holds both. */
export type CarryHold = 'none' | 'paw' | 'front';

const setArm = (arm: ArmOut, pitch: number, roll: number) => { arm.pitch = pitch; arm.roll = roll; arm.active = true; };
/** 0→1 over the first `edge` of [0, 1] and back to 0 over the last. */
function envelope(progress: number, edge = 0.18): number {
  const p = Math.min(1, Math.max(0, progress));
  const up = Math.min(1, p / edge), down = Math.min(1, (1 - p) / edge);
  const e = Math.min(up, down);
  return e * e * (3 - 2 * e);
}

/**
 * Fills `out` for `mode`. `seconds` is the scene clock plus the agent's phase, `age` ms since the
 * current greet/think beat started, `stride` metres walked (drives the walk bob in step with legSwing).
 * Reduced motion holds a static pose for each mode: no oscillation, no bob.
 */
export function poseAgent(out: AgentPose, mode: AgentMode, seconds: number, age: number, stride: number, carry: CarryHold, reduced: boolean): AgentPose {
  const t = Number.isFinite(seconds) ? seconds : 0;
  const live = reduced ? 0 : 1;
  out.mode = mode;
  out.bob = 0; out.lean = 0;
  out.sway = Math.sin(t * 0.9) * 0.025 * live;
  out.breath = Math.sin(t * 2.1) * 0.018 * live;
  out.headTilt = Math.sin(t * 0.7) * 0.07 * live;
  out.headPitch = Math.sin(t * 1.3 + 1) * 0.03 * live;
  out.arms[0].active = false; out.arms[1].active = false;
  const right = carry === 'none', left = carry !== 'front';
  // The free arm for a one-armed gesture: right unless the right paw holds the folder.
  const free: 0 | 1 | -1 = right ? 1 : left ? 0 : -1;
  const gesture = free === -1 ? null : out.arms[free];
  switch (mode) {
    case 'walk': {
      // Two steps per legSwing cycle (sin(distance * 9)): the body rises on each.
      out.bob = Math.abs(Math.sin(stride * 9)) * 0.035 * live;
      out.lean = 0.07 * live;
      out.sway = Math.sin(stride * 9) * 0.03 * live;
      out.headPitch = -0.04 * live;
      break;
    }
    case 'type': {
      // Paws forward on the keyboard, tapping out of phase; head down at the screen.
      const tapL = reduced ? 0 : Math.max(0, Math.sin(t * 15)) * 0.14;
      const tapR = reduced ? 0 : Math.max(0, Math.sin(t * 15 + Math.PI * 0.85)) * 0.14;
      if (left) setArm(out.arms[0], -1.15 + tapL, 0.28);
      if (right) setArm(out.arms[1], -1.15 + tapR, -0.28);
      out.headPitch = 0.2 + Math.sin(t * 15) * 0.012 * live;
      out.headTilt *= 0.4;
      break;
    }
    case 'talk': {
      // Listening: a slow nod and a small open-paw gesture.
      out.headPitch = Math.sin(t * 2.2) * 0.06 * live;
      if (gesture) setArm(gesture, -0.45 + Math.sin(t * 2.4) * 0.12 * live, (free === 1 ? 1 : -1) * 0.12);
      break;
    }
    case 'greet': {
      const progress = age / GREET_MS;
      const e = reduced ? 1 : envelope(progress);
      const side = free === 1 ? 1 : -1;
      // Paw raised out to the side and waved; two quick nods.
      if (gesture) setArm(gesture, -0.25 * e, side * (2.45 * e + Math.sin(age / 1000 * 15) * 0.38 * e * live));
      out.headPitch = reduced ? 0.12 : Math.max(0, Math.sin(progress * Math.PI * 4)) * 0.22 * e;
      out.headTilt = side * -0.08 * e;
      out.bob = Math.max(0, Math.sin(progress * Math.PI * 4)) * 0.02 * live;
      break;
    }
    case 'think': {
      // Paw to chin, head tilted and up, a gentle bob while the answer comes.
      const e = reduced ? 1 : envelope(age / THINK_MS, 0.2);
      if (gesture) setArm(gesture, -2.25 * e, (free === 1 ? -1 : 1) * 0.55 * e);
      out.headTilt = 0.2 * e + Math.sin(t * 1.6) * 0.04 * live;
      out.headPitch = -0.12 * e;
      out.bob = (Math.sin(age / 1000 * 7) * 0.5 + 0.5) * 0.03 * e * live;
      break;
    }
    case 'idle': break;
  }
  return out;
}
