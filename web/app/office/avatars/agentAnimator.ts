import { useRef } from 'react';
import type { Camera, Object3D } from 'three';
import {
  agentCues, agentMode, angleDelta, createAgentPose, damp, facesPlayer, lookYaw, poseAgent, transientMode, type AgentMode,
} from '../../../lib/office/agent-motion';
import { bearPhase } from '../../../lib/office/bear';
import type { BearRig } from './Bear';
import { BEAR_SEAT_LIFT, SIT_HIP_RAD, easeSeat, seatAtApproach, stepSeatBlend, type DeskSeat } from '../../../lib/office/baked-seat';

/** What the owner's useFrame knows about the agent this frame (reused, never reallocated). */
export interface AnimateInput {
  x: number; z: number;
  /** Walk heading (atan2(dx, dz)). */
  heading: number;
  moving: boolean;
  /** Metres walked, for the bob in step with legSwing. */
  stride: number;
  /** Heading toward the agent's desk when seated at it, else NaN (no typing). */
  desk: number;
  reduced: boolean;
}
interface FrameState { camera: Camera; invalidate: () => void; clock: { elapsedTime: number } }
const BLEND_MS = 220;
/** root bob, lean, sway; head pitch, tilt; left arm pitch, roll; right arm pitch, roll. */
const BLEND_SLOTS = 9;
const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const isFirstPerson = (camera: Camera) => (camera as Camera & { isPerspectiveCamera?: boolean }).isPerspectiveCamera === true;

/**
 * Per-agent procedural animation on a Bear rig. Call `animate` from the owner's useFrame after
 * poseBear: it turns the body (walk heading, desk, or the player while greeting/talking), turns the
 * head toward a first-person player within LOOK_RANGE, and layers the mode pose on the rig. The scene
 * renders on demand: frames are requested only while a greet/think beat, a mode cross-fade, a body turn
 * or a head turn is in progress. Idle breathing and typing play on frames that are already rendering.
 */
export class AgentAnimator {
  readonly input: AnimateInput = { x: 0, z: 0, heading: 0, moving: false, stride: 0, desk: NaN, reduced: false };
  readonly pose = createAgentPose();
  mode: AgentMode = 'idle';
  private headYaw = 0;
  private seatBlend = 0;
  private seat: DeskSeat | null = null;
  /** Shared with the baked clone so a seat tween never looks like walking. */
  private readonly motion = { x: 0, z: 0, moving: false, seated: 0, mode: 'idle' as AgentMode };
  private readonly phase: number;
  /** Mode-change cross-fade: what was applied last frame, captured when the mode changes. */
  private changedAt = -Infinity;
  private readonly last = new Float64Array(BLEND_SLOTS);
  private readonly from = new Float64Array(BLEND_SLOTS);
  private blend = 1;
  /** Cross-fades one value from the captured pose; bound once so a frame allocates nothing. */
  private readonly mix = (slot: number, target: number) => {
    const { last, from, blend } = this;
    return last[slot] = blend >= 1 ? target : from[slot]! + (target - from[slot]!) * blend;
  };

  constructor(readonly key: string, seed: string, private readonly rig: BearRig) {
    this.phase = bearPhase(seed);
    rig.driven = true;
  }

  animate(state: FrameState, delta: number, body: Object3D) {
    const { input, rig, pose } = this;
    const now = performance.now();
    const cue = agentCues.get(this.key);
    const station = !input.moving ? seatAtApproach(input.x, input.z) : null;
    const atDesk = !!station || Number.isFinite(input.desk);
    const mode = agentMode(input.moving, atDesk && rig.carry !== 'front', cue, now);
    if (station) this.seat = station;
    const seated = !!station && !facesPlayer(mode) && rig.carry !== 'front';
    this.seatBlend = stepSeatBlend(this.seatBlend, seated, Math.min(delta, 0.1), input.reduced);
    const sit = easeSeat(this.seatBlend);
    const seat = this.seat;
    body.position.x = input.x + (seat ? seat.x - input.x : 0) * sit;
    body.position.z = input.z + (seat ? seat.z - input.z : 0) * sit;
    this.motion.x = input.x; this.motion.z = input.z; this.motion.moving = input.moving;
    this.motion.seated = sit; this.motion.mode = mode;
    body.userData.agentMotion = this.motion;
    if (mode !== this.mode) { this.mode = mode; this.changedAt = now; this.from.set(this.last); }
    const blend = input.reduced ? 1 : smooth((now - this.changedAt) / BLEND_MS);
    const firstPerson = isFirstPerson(state.camera);
    const px = firstPerson ? state.camera.position.x : NaN, pz = firstPerson ? state.camera.position.z : NaN;

    // Body: face the player for a conversation, the desk while typing, else the walk heading.
    const facing = facesPlayer(mode) && firstPerson ? Math.atan2(px - input.x, pz - input.z) : seated ? station!.heading : input.heading;
    const turn = angleDelta(body.rotation.y, facing);
    body.rotation.y = input.reduced ? facing : body.rotation.y + turn * (1 - Math.exp(-(input.moving ? 12 : 7) * Math.min(delta, 0.1)));
    const turning = !input.reduced && Math.abs(turn) > 0.01;

    // Head: look at a nearby first-person player (relative to where the body points now).
    const wanted = seated ? 0 : lookYaw(body.rotation.y, body.position.x, body.position.z, px, pz);
    this.headYaw = input.reduced ? wanted : damp(this.headYaw, wanted, 6, delta);
    const looking = !input.reduced && Math.abs(wanted - this.headYaw) > 0.005;

    const age = mode === 'greet' ? now - cue!.greetAt : mode === 'think' ? now - cue!.thinkAt : 0;
    poseAgent(pose, mode, state.clock.elapsedTime + this.phase, age, input.stride, rig.carry, input.reduced);
    this.blend = blend;
    const mix = this.mix;
    if (rig.root) {
      rig.root.position.y = mix(0, pose.bob) * (1 - sit) + BEAR_SEAT_LIFT * sit;
      rig.root.rotation.x = mix(1, pose.lean);
      rig.root.rotation.z = mix(2, pose.sway);
    }
    rig.legs?.children.forEach(leg => {
      leg.rotation.x = leg.rotation.x * (1 - sit) - SIT_HIP_RAD * sit;
      const shin = leg.getObjectByName('shin');
      if (shin) shin.rotation.x = SIT_HIP_RAD * sit;
    });
    if (rig.chest) { rig.chest.scale.x = 1 + pose.breath; rig.chest.scale.z = 1 + pose.breath; }
    if (rig.head) rig.head.rotation.set(mix(3, pose.headPitch), this.headYaw, mix(4, pose.headTilt));
    // Inactive arms blend toward the walk swing / carry pose poseBear already set this frame.
    const arms = rig.arms?.children;
    if (arms) for (let i = 0; i < 2 && i < arms.length; i++) {
      const arm = pose.arms[i]!, rotation = arms[i]!.rotation;
      rotation.x = mix(5 + i * 2, arm.active ? arm.pitch : rotation.x);
      rotation.z = mix(6 + i * 2, arm.active ? arm.roll : rotation.z);
    }
    if (transientMode(mode) || blend < 1 || turning || looking || this.seatBlend !== (seated ? 1 : 0)) state.invalidate();
  }
}

/** One stable animator per mounted bear (re-created only when its cue key changes). */
export function useAgentAnimator(key: string, seed: string, rig: BearRig): AgentAnimator {
  const ref = useRef<AgentAnimator | null>(null);
  if (!ref.current || ref.current.key !== key) ref.current = new AgentAnimator(key, seed, rig);
  return ref.current;
}
