// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  GREET_MS, HEAD_YAW_LIMIT, LOOK_RANGE, THINK_MS, agentCueKey, agentMode, angleDelta, createAgentCues, createAgentPose, cueKeyFor,
  damp, deskHeading, facesPlayer, handoffCueKey, lookYaw, poseAgent, transientMode, type AgentCue, type AgentMode,
} from './agent-motion';
import { OFFICE_ANCHORS } from './state';
import { Group, PerspectiveCamera } from 'three';
import { AgentAnimator } from '../../app/office/avatars/agentAnimator';
import { createBearRig, poseBear } from '../../app/office/avatars/Bear';
import { agentCues } from './agent-motion';
import { BEAR_SEAT_LIFT, SIT_HIP_RAD, deskSeat, seatAtApproach } from './baked-seat';
import { WORKSTATIONS, workstationApproach } from './layout';

const cue = (over: Partial<AgentCue> = {}): AgentCue => ({ greetAt: -Infinity, thinkAt: -Infinity, talking: false, ...over });

describe('agent motion state machine', () => {
  it('is idle standing, typing at the desk and walking while moving', () => {
    expect(agentMode(false, false, undefined, 0)).toBe('idle');
    expect(agentMode(false, true, undefined, 0)).toBe('type');
    expect(agentMode(true, true, cue({ talking: true, greetAt: 0 }), 10)).toBe('walk');
  });

  it('greets for GREET_MS after E, then talks while the dialog is open, then goes back to typing', () => {
    const c = cue({ greetAt: 1000, talking: true });
    expect(agentMode(false, true, c, 999)).toBe('talk');
    expect(agentMode(false, true, c, 1000)).toBe('greet');
    expect(agentMode(false, true, c, 1000 + GREET_MS - 1)).toBe('greet');
    expect(agentMode(false, true, c, 1000 + GREET_MS)).toBe('talk');
    c.talking = false;
    expect(agentMode(false, true, c, 5000)).toBe('type');
    expect(agentMode(false, false, c, 5000)).toBe('idle');
  });

  it('thinks for THINK_MS after a question, and a fresh greet wins over thinking', () => {
    const c = cue({ thinkAt: 2000, talking: true });
    expect(agentMode(false, false, c, 2000 + THINK_MS / 2)).toBe('think');
    expect(agentMode(false, false, c, 2000 + THINK_MS)).toBe('talk');
    c.greetAt = 2100;
    expect(agentMode(false, false, c, 2200)).toBe('greet');
  });

  it('marks timed beats and conversation modes', () => {
    const modes: AgentMode[] = ['idle', 'walk', 'type', 'talk', 'greet', 'think'];
    expect(modes.filter(transientMode)).toEqual(['greet', 'think']);
    expect(modes.filter(facesPlayer)).toEqual(['talk', 'greet', 'think']);
  });
});

describe('agent cues', () => {
  it('keys agents and handoff figures like their Play targets', () => {
    expect(cueKeyFor({ kind: 'agent', id: 'payables-clerk' })).toBe(agentCueKey('payables-clerk'));
    expect(cueKeyFor({ kind: 'handoff', actor: 'collector' })).toBe(handoffCueKey('collector'));
    expect(cueKeyFor({ kind: 'desk' })).toBeNull();
  });

  it('greets, thinks and keeps one conversation at a time, waking the scene each time', () => {
    const wake = vi.fn();
    const cues = createAgentCues(wake);
    cues.greet('agent:a', 5);
    cues.think('agent:a', 9);
    expect(cues.get('agent:a')).toEqual({ greetAt: 5, thinkAt: 9, talking: false });
    cues.setTalking('agent:a');
    cues.setTalking('agent:b');
    expect(cues.get('agent:a')!.talking).toBe(false);
    expect(cues.get('agent:b')!.talking).toBe(true);
    cues.setTalking('agent:b');
    cues.setTalking(null);
    expect(cues.get('agent:b')!.talking).toBe(false);
    expect(wake).toHaveBeenCalledTimes(5);
  });
});

describe('agent motion geometry', () => {
  it.each(['collections', 'payables', 'vendor_onboarding', 'dana'] as const)('faces the monitor at %s', room => {
    expect(deskHeading(room, ...OFFICE_ANCHORS[room].position)).toBe(deskSeat(room)!.heading);
  });
  it('faces the desk only when seated at a desk seat', () => {
    const [x, z] = OFFICE_ANCHORS.payables.position;
    expect(Math.abs(angleDelta(deskHeading('payables', x, z), Math.PI))).toBeLessThan(1e-9);
    expect(deskHeading('payables', x + 1, z)).toBeNaN();
    expect(deskHeading('lobby', ...OFFICE_ANCHORS.lobby.position)).toBeNaN();
    expect(deskHeading('unknown', 0, 0)).toBeNaN();
  });

  it('turns the head toward a first-person player in range, clamped to the neck', () => {
    expect(lookYaw(0, 0, 0, 1, 1)).toBeCloseTo(Math.PI / 4);
    expect(Math.abs(lookYaw(0, 0, 0, 0, -1))).toBe(HEAD_YAW_LIMIT);
    expect(lookYaw(0, 0, 0, LOOK_RANGE + 0.1, 0)).toBe(0);
    expect(lookYaw(0, 0, 0, NaN, NaN)).toBe(0);
    expect(lookYaw(Math.PI * 4, 0, 0, 1, 0)).toBeCloseTo(HEAD_YAW_LIMIT);
  });

  it('wraps angles and damps frame-rate independently', () => {
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(angleDelta(0, Math.PI * 6 + 0.3)).toBeCloseTo(0.3);
    const once = damp(0, 1, 6, 0.1);
    const twice = damp(damp(0, 1, 6, 0.05), 1, 6, 0.05);
    expect(once).toBeCloseTo(twice);
    expect(damp(0, 1, 6, 5)).toBe(damp(0, 1, 6, 0.1));
  });
});

describe('rendered seat transitions', () => {
  function fixture(index: number) {
    const rig = createBearRig();
    rig.root = new Group(); rig.legs = new Group(); rig.head = new Group();
    for (let i = 0; i < 2; i++) {
      const leg = new Group(), shin = new Group(); shin.name = 'shin'; leg.add(shin); rig.legs.add(leg);
    }
    const body = new Group(); body.add(rig.root);
    const animator = new AgentAnimator('handoff:seated-test', 'seated-test', rig);
    const [x, z] = workstationApproach(index);
    Object.assign(animator.input, { x, z }); // HandoffLayer deliberately passes desk: NaN.
    const state = { camera: new PerspectiveCamera(), invalidate: vi.fn(), clock: { elapsedTime: 1 } };
    state.camera.position.set(x, 1.7, z + 2);
    const frame = () => {
      body.position.set(animator.input.x, 0, animator.input.z);
      poseBear(rig, 0, animator.input.moving, animator.input.reduced);
      animator.animate(state, 1 / 60, body);
    };
    const settle = () => { for (let i = 0; i < 180; i++) frame(); };
    return { rig, body, animator, state, frame, settle };
  }

  it.each(WORKSTATIONS.map((_, i) => i))('sits on workstation %i with bent knees and eyes on the monitor', index => {
    const { rig, body, animator, settle } = fixture(index);
    settle();
    const seat = seatAtApproach(animator.input.x, animator.input.z)!;
    expect(body.position.x).toBeCloseTo(seat.x);
    expect(body.position.z).toBeCloseTo(seat.z);
    expect(Math.abs(angleDelta(body.rotation.y, seat.heading))).toBeLessThan(0.001);
    expect(rig.root!.position.y).toBeCloseTo(BEAR_SEAT_LIFT);
    expect(rig.head!.rotation.y).toBe(0);
    for (const leg of rig.legs!.children) {
      expect(leg.rotation.x).toBeCloseTo(-SIT_HIP_RAD);
      expect(leg.getObjectByName('shin')!.rotation.x).toBeCloseTo(SIT_HIP_RAD);
    }
  });

  it('tweens out for conversation or a carried handoff, then sits again without a positional pop', () => {
    const { rig, body, animator, frame, settle, state } = fixture(9);
    try {
      settle();
      const seatedZ = body.position.z;
      agentCues.setTalking('handoff:seated-test');
      frame();
      expect(body.position.z).toBeGreaterThan(seatedZ);
      expect(body.position.z).toBeLessThan(animator.input.z);
      expect(state.invalidate).toHaveBeenCalled();
      settle();
      expect(body.userData.agentMotion.seated).toBe(0);
      expect(body.position.z).toBeCloseTo(animator.input.z);
      expect(body.rotation.y).toBeCloseTo(0, 3);
      agentCues.setTalking(null);
      frame();
      expect(body.position.z).toBeGreaterThan(seatedZ);
      expect(body.position.z).toBeLessThan(animator.input.z);
      settle();
      expect(body.userData.agentMotion.seated).toBe(1);
      rig.carry = 'front'; settle();
      expect(body.userData.agentMotion.seated).toBe(0);
      rig.carry = 'none'; settle();
      expect(body.userData.agentMotion.seated).toBe(1);
      animator.input.moving = true; frame();
      expect(body.userData.agentMotion.seated).toBeGreaterThan(0);
      settle();
      expect(body.userData.agentMotion.seated).toBe(0);
    } finally { agentCues.clear(); }
  });

  it('holds the seated and standing poses immediately with reduced motion', () => {
    const { body, animator, rig, frame } = fixture(0);
    animator.input.reduced = true;
    frame();
    expect(body.userData.agentMotion.seated).toBe(1);
    rig.carry = 'front'; frame();
    expect(body.userData.agentMotion.seated).toBe(0);
  });
});

describe('agent poses', () => {
  it('fills the same pose object without allocating', () => {
    const pose = createAgentPose();
    const arms = pose.arms;
    for (const mode of ['idle', 'walk', 'type', 'talk', 'greet', 'think'] as const) {
      expect(poseAgent(pose, mode, 1.3, 400, 2, 'none', false)).toBe(pose);
      expect(pose.arms).toBe(arms);
      expect(pose.mode).toBe(mode);
      for (const value of [pose.bob, pose.lean, pose.sway, pose.breath, pose.headPitch, pose.headTilt, ...arms.flatMap(a => [a.pitch, a.roll])]) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('breathes and sways idle, bobs and leans walking, and leaves the arms to the walk swing', () => {
    const pose = createAgentPose();
    poseAgent(pose, 'idle', 0.4, 0, 0, 'none', false);
    expect(Math.abs(pose.breath)).toBeGreaterThan(0);
    expect(pose.arms.some(a => a.active)).toBe(false);
    poseAgent(pose, 'walk', 0, 0, 0.1, 'none', false);
    expect(pose.bob).toBeGreaterThan(0);
    expect(pose.lean).toBeGreaterThan(0);
    expect(pose.arms.some(a => a.active)).toBe(false);
  });

  it('types with both paws forward, alternating', () => {
    const pose = createAgentPose();
    const left: number[] = [], right: number[] = [];
    for (let t = 0; t < 1; t += 0.02) {
      poseAgent(pose, 'type', t, 0, 0, 'none', false);
      left.push(pose.arms[0].pitch); right.push(pose.arms[1].pitch);
    }
    expect(Math.max(...left)).toBeLessThan(-0.9);
    expect(Math.max(...left) - Math.min(...left)).toBeGreaterThan(0.1);
    expect(left.some((l, i) => Math.abs(l - right[i]!) > 0.05)).toBe(true);
    expect(pose.headPitch).toBeGreaterThan(0.1);
  });

  it('waves the free paw high mid-greet and drops it by the end', () => {
    const pose = createAgentPose();
    poseAgent(pose, 'greet', 0, GREET_MS / 2, 0, 'none', false);
    expect(pose.arms[1].active).toBe(true);
    expect(pose.arms[1].roll).toBeGreaterThan(1.8);
    poseAgent(pose, 'greet', 0, GREET_MS, 0, 'none', false);
    expect(Math.abs(pose.arms[1].roll)).toBeLessThan(0.01);
    // The escalation folder is in the right paw: wave with the left.
    poseAgent(pose, 'greet', 0, GREET_MS / 2, 0, 'paw', false);
    expect(pose.arms[1].active).toBe(false);
    expect(pose.arms[0].roll).toBeLessThan(-1.8);
    // Both paws hold a folder: just the nod.
    poseAgent(pose, 'greet', 0, GREET_MS / 8, 0, 'front', false);
    expect(pose.arms.some(a => a.active)).toBe(false);
  });

  it('brings a paw to the chin and bobs while thinking', () => {
    const pose = createAgentPose();
    const bobs: number[] = [];
    for (let age = THINK_MS * 0.3; age < THINK_MS * 0.7; age += 40) { poseAgent(pose, 'think', 0, age, 0, 'none', false); bobs.push(pose.bob); }
    expect(pose.arms[1].pitch).toBeLessThan(-2);
    expect(pose.headTilt).toBeGreaterThan(0.1);
    expect(Math.max(...bobs) - Math.min(...bobs)).toBeGreaterThan(0.01);
  });

  it('holds a near-static pose under reduced motion', () => {
    const pose = createAgentPose();
    for (const mode of ['idle', 'walk', 'type', 'talk', 'greet', 'think'] as const) {
      const samples = [0, 0.37, 1.1, 2.9].map(t => {
        poseAgent(pose, mode, t, t * 300, t, 'none', true);
        return [pose.bob, pose.lean, pose.sway, pose.breath, pose.headPitch, pose.headTilt, pose.arms[0].pitch, pose.arms[0].roll, pose.arms[1].pitch, pose.arms[1].roll].map(v => v + 0);
      });
      for (const sample of samples) expect(sample).toEqual(samples[0]);
      expect(pose.bob + 0).toBe(0);
      expect(pose.breath + 0).toBe(0);
    }
  });
});
