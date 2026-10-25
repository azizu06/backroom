'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, MathUtils, Mesh, Vector3, type MeshStandardMaterial } from 'three';
import { REDUCED_MOTION_QUERY, legSwing } from '../../../lib/office/a11y';
import { FLOOR_AGENTS, HANDOFF_AGENTS, HUMAN, type HandoffAgentId } from '../../../lib/office/handoffs';
import { nextChange, type HandoffFrame, type HandoffStage } from '../../../lib/office/handoff-plan';
import { setHandoffText } from '../../../lib/office/handoff-text';
import { Bear, createBearRig, poseBear, type BearRig } from '../avatars/Bear';
import { AgentAnimator } from '../avatars/agentAnimator';
import { handoffCueKey } from '../../../lib/office/agent-motion';

/** Looks up the HTML tag (name + speech bubble) Office renders for a handoff agent. */
export type HandoffTagLookup = (actor: HandoffAgentId) => HTMLDivElement | undefined;
const FOLDER_POOL = 8;
const MANILA = '#e0b365', RETURNED = '#e0574a', CORRECTION = '#f3bf65';

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => false);
}

/** Dana stays a person; every agent is a Bear. */
function Figure({ color, coat = '#414b43', registerLegs }: { color: string; coat?: string; registerLegs?: (legs: Group | null) => void }) {
  return <>
    <mesh position={[0, 0.83, 0]} castShadow><boxGeometry args={[0.43, 0.6, 0.28]} /><meshStandardMaterial color={color} /></mesh>
    <mesh position={[0, 1.3, 0]} castShadow><boxGeometry args={[0.34, 0.36, 0.32]} /><meshStandardMaterial color='#c58d67' /></mesh>
    <mesh position={[0, 1.49, -0.02]}><boxGeometry args={[0.36, 0.1, 0.35]} /><meshStandardMaterial color='#3c342e' /></mesh>
    {[-1, 1].map(side => <mesh key={side} position={[side * 0.3, 0.84, 0.06]}><boxGeometry args={[0.14, 0.48, 0.18]} /><meshStandardMaterial color={color} /></mesh>)}
    <group ref={registerLegs}>{[-1, 1].map(side => <mesh key={side} position={[side * 0.12, 0.3, 0]} castShadow>
      <boxGeometry args={[0.18, 0.55, 0.22]} /><meshStandardMaterial color={coat} />
    </mesh>)}</group>
  </>;
}

/**
 * Agent-to-agent handoffs: one bear per backend agent at its station, folders passed between them,
 * and Dana only at the passkey step. Positions come from the pure plan (handoff-plan.ts); this layer only
 * draws them. Renders on demand: frames are requested while someone walks or a folder is mid-pass, and a
 * timer wakes the scene for the next bubble or leg start.
 */
export function HandoffLayer({ stage, tag }: { stage: HandoffStage; tag?: HandoffTagLookup }) {
  const reduced = useReducedMotion();
  const invalidate = useThree(state => state.invalidate);
  const bodies = useRef(new Map<HandoffAgentId, Group>());
  const humanLegs = useRef<Group | null>(null);
  const rigs = useRef(new Map<HandoffAgentId, BearRig>(FLOOR_AGENTS.map(id => [id, createBearRig()])));
  const animators = useRef(new Map<HandoffAgentId, AgentAnimator>([...rigs.current].map(([id, rig]) => [id, new AgentAnimator(handoffCueKey(id), id, rig)])));
  const rings = useRef(new Map<HandoffAgentId, Mesh>());
  const human = useRef<Group>(null);
  const folders = useRef<(Group | null)[]>([]);
  const wake = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | undefined }>({ at: NaN, timer: undefined });
  const point = useRef(new Vector3());

  useEffect(() => { invalidate(); }, [reduced, invalidate]);
  useEffect(() => () => { clearTimeout(wake.current.timer); }, []);

  useFrame((state, delta) => {
    const now = Date.now();
    const frame: HandoffFrame = stage.sample(now, reduced);
    const carriers = new Set(frame.folders.map(folder => folder.carrier));
    for (const actor of frame.actors) {
      const body = actor.id === HUMAN ? human.current : bodies.current.get(actor.id);
      if (!body) continue;
      body.position.set(actor.position[0], 0, actor.position[1]);
      const rig = rigs.current.get(actor.id);
      const animator = animators.current.get(actor.id);
      if (rig && animator) {
        rig.carry = carriers.has(actor.id) ? 'front' : 'none';
        poseBear(rig, actor.stride, actor.moving, reduced);
        // Body turn (requests frames until it settles), head look, walk bob and greet/talk beats.
        const input = animator.input;
        input.x = actor.position[0]; input.z = actor.position[1]; input.heading = actor.heading; input.moving = actor.moving;
        input.stride = actor.stride; input.desk = NaN; input.reduced = reduced;
        animator.animate(state, delta, body);
      } else {
        // Dana snaps to face her partner: no frames are requested while nobody moves, so a turn could stall.
        if (reduced || !actor.moving) body.rotation.y = actor.heading;
        else {
          const turn = MathUtils.euclideanModulo(actor.heading - body.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
          body.rotation.y += turn * (1 - Math.exp(-12 * Math.min(delta, 0.1)));
        }
        humanLegs.current?.children.forEach((leg, i) => { leg.rotation.x = legSwing(actor.stride, i, actor.moving, reduced); });
      }
      const ring = rings.current.get(actor.id);
      if (ring) {
        ring.visible = actor.returning;
        const correction = frame.bubbles.some(bubble => bubble.actor === actor.id && bubble.tone === 'correction');
        (ring.material as MeshStandardMaterial).color.set(correction ? CORRECTION : RETURNED);
      }
    }
    if (human.current) human.current.visible = frame.human;
    folders.current.forEach((group, i) => {
      if (!group) return;
      const folder = frame.folders[i];
      group.visible = !!folder;
      if (!folder) return;
      group.position.set(...folder.position);
      const cover = group.children[0] as Mesh | undefined;
      (cover?.material as MeshStandardMaterial | undefined)?.color.set(folder.failed ? RETURNED : folder.correction ? CORRECTION : MANILA);
    });
    // Tags and bubbles: projected like the agent name tags.
    if (tag) {
      const bubbles = new Map(frame.bubbles.map(bubble => [bubble.actor, bubble]));
      for (const actor of frame.actors) {
        const element = tag(actor.id);
        if (!element) continue;
        const shown = actor.id !== HUMAN || frame.human;
        point.current.set(actor.position[0], 1.95, actor.position[1]).project(state.camera);
        const offscreen = Math.abs(point.current.x) > 1.05 || Math.abs(point.current.y) > 1.05 || point.current.z > 1;
        element.style.visibility = shown && !offscreen ? 'visible' : 'hidden';
        element.style.transform = `translate(${(point.current.x + 1) * state.size.width / 2}px, ${(1 - point.current.y) * state.size.height / 2}px) translate(-50%, -100%)`;
        element.dataset.returning = actor.returning ? 'true' : 'false';
        element.dataset.correction = bubbles.get(actor.id)?.tone === 'correction' ? 'true' : 'false';
        const bubble = bubbles.get(actor.id);
        const box = element.firstElementChild as HTMLElement | null;
        if (!box) continue;
        if (bubble && shown) {
          setHandoffText(box, bubble.text);
          box.dataset.tone = bubble.tone;
          box.hidden = false;
        } else if (!box.hidden) {
          box.hidden = true;
        }
      }
    }
    if (frame.animating) state.invalidate();
    // Wake the on-demand renderer for the next change that does not move anything (a bubble, Dana, a start).
    const next = nextChange(stage.plan, now);
    if (next !== wake.current.at) {
      clearTimeout(wake.current.timer);
      wake.current.at = next ?? NaN;
      wake.current.timer = next === null ? undefined : setTimeout(() => { wake.current.at = NaN; invalidate(); }, Math.min(2 ** 31 - 1, Math.max(0, next - Date.now()) + 5));
    }
  });

  return <group name='handoffs'>
    {FLOOR_AGENTS.map(id => {
      const { station, color } = HANDOFF_AGENTS[id];
      return <group key={id} name={`handoff-agent:${id}`} position={[station[0], 0, station[1]]}
        ref={group => { if (group) bodies.current.set(id, group); else bodies.current.delete(id); }}>
        <Bear color={color} seed={id} rig={rigs.current.get(id)} />
        {/* Return-trip cue: a red ring under an agent walking a failed folder back. */}
        <mesh ref={mesh => { if (mesh) rings.current.set(id, mesh); else rings.current.delete(id); }} visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <ringGeometry args={[0.38, 0.5, 24]} /><meshBasicMaterial color={RETURNED} transparent opacity={0.9} />
        </mesh>
      </group>;
    })}
    <group ref={human} name='handoff-human' visible={false} position={[HANDOFF_AGENTS.human.station[0], 0, HANDOFF_AGENTS.human.station[1]]}>
      <Figure color={HANDOFF_AGENTS.human.color} coat='#2f3a45' registerLegs={group => { humanLegs.current = group; }} />
      {/* Passkey card in Dana's hand. */}
      <mesh position={[0.32, 1.02, 0.22]}><boxGeometry args={[0.16, 0.1, 0.02]} /><meshStandardMaterial color='#f3dfb9' emissive='#c3b68e' emissiveIntensity={0.4} /></mesh>
    </group>
    {Array.from({ length: FOLDER_POOL }, (_, i) => <group key={i} visible={false} ref={group => { folders.current[i] = group; }}>
      <mesh castShadow><boxGeometry args={[0.36, 0.05, 0.28]} /><meshStandardMaterial color={MANILA} /></mesh>
      <mesh position={[0, 0.03, 0]}><boxGeometry args={[0.3, 0.02, 0.24]} /><meshStandardMaterial color='#f3dfb9' /></mesh>
    </group>)}
  </group>;
}
