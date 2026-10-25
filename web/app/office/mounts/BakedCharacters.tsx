'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AnimationMixer, Euler, LoopRepeat, Quaternion, Vector3, type AnimationAction, type AnimationClip, type Group, type Mesh, type Object3D,
} from 'three';
import { facesPlayer, type AgentMode } from '../../../lib/office/agent-motion';
import { bakedArtRequested } from '../../../lib/office/baked-art';
import {
  CHARACTER_CLIPS, CHARACTER_GLB_URL, CLIP_FADE_SECONDS, WALK_CLIP_SPEED, agentBodyColor, applyCharacterVariant, atOwnDesk, bakedTalkingAgent,
  characterClip, characterVariant, characterYaw, disposeClonedBody, recolorBody, setBakedCharacterReady, subscribeBakedTalking,
  type CharacterClip,
} from '../../../lib/office/baked-character';
import {
  SIT_HIP_RAD, SIT_LIFT_M, angleDelta, deskSeat, easeSeat, headingToward, isSeatDesk, seatPieces, stepSeatBlend, turnToward,
  type DeskSeat,
} from '../../../lib/office/baked-seat';
import { visibleRooms, type OfficeAgent } from '../../../lib/office/state';
import { CONTACT_DYNAMIC_LAYER } from '../../../lib/office/lighting';
import { useReducedMotion } from './shared';
import { AvatarAnchors } from '../avatars/AvatarAnchors';
import { StaticBoxes } from './StaticGeometry';
import type { SceneMountProps } from './types';

const scratchPosition = new Vector3();
const scratchEuler = new Euler();
const scratchActivity = { moving: false, talking: false, atDesk: false };
/** Below this per-frame travel (m) the avatar counts as standing. */
const STILL_EPSILON = 0.0005;
/** Below this heading error (rad) a turn counts as done and stops requesting frames. */
const TURN_EPSILON = 0.002;
const X_AXIS = new Vector3(1, 0, 0);

interface CharacterTemplate {
  readonly scene: Group;
  readonly clips: ReadonlyMap<string, AnimationClip>;
  /** Skeleton-aware clone (each agent gets its own bones). */
  readonly clone: (source: Group) => Group;
}

/** One clone's playback. `mixer` is null when the GLB has no clips: the clone keeps its rest pose. */
interface Puppet {
  readonly object: Group;
  /** Refreshed when the agent set changes, alongside clone synchronization. */
  body: Object3D | undefined;
  /** Fixed for this clone's seat id; a seat change replaces the clone. */
  readonly deskSeat: DeskSeat | null;
  readonly mixer: AnimationMixer | null;
  readonly actions: Map<CharacterClip, AnimationAction>;
  readonly available: ReadonlySet<string>;
  current: CharacterClip | null;
  fadeLeft: number;
  last: [number, number] | null;
  /** Thigh and shin bones with their seated local rotations; null when the rig lacks them (never sits). */
  readonly legs: SeatedLegs | null;
  /** 0 standing at the anchor, 1 seated on the chair. */
  seat: number;
  /** Drawn heading (avatar convention), smoothed toward the desk, the player or the avatar's own heading. */
  heading: number | null;
}

interface SeatedLegs {
  readonly bones: readonly Object3D[];
  readonly seated: readonly Quaternion[];
}

/** Rotation of `node` relative to `root` (product of local rotations below the root). */
function rootRelative(node: Object3D, root: Object3D, out: Quaternion): Quaternion {
  out.identity();
  for (let current: Object3D | null = node; current && current !== root; current = current.parent) out.premultiply(current.quaternion);
  return out;
}

/**
 * Seated local rotations from the clone's rest pose: each thigh swings forward SIT_HIP_RAD about the model's x axis
 * (the GLB faces -Z, so +x rotation lifts a hanging limb forward) and each shin swings back by the same angle so it
 * hangs straight down again. Computed once per clone; the frame loop only slerps toward them.
 */
function seatedLegs(object: Group): SeatedLegs | null {
  const hip = new Quaternion().setFromAxisAngle(X_AXIS, SIT_HIP_RAD);
  const bones: Object3D[] = [];
  const seated: Quaternion[] = [];
  for (const side of ['L', 'R']) {
    const thigh = object.getObjectByName(`thigh_${side}`);
    const shin = object.getObjectByName(`shin_${side}`);
    if (!thigh?.parent || !shin) return null;
    const parent = rootRelative(thigh.parent, object, new Quaternion());
    // thigh' = P^-1 * R * P * thigh (R applied in model space).
    const thighSeated = parent.clone().invert().multiply(hip).multiply(parent).multiply(thigh.quaternion);
    // shin' = T^-1 * R^-1 * T * shin, T = the thigh's rest model rotation: undoes the hip swing for the shin.
    const model = parent.clone().multiply(thigh.quaternion);
    const shinSeated = model.clone().invert().multiply(hip.clone().invert()).multiply(model).multiply(shin.quaternion);
    bones.push(thigh, shin);
    seated.push(thighSeated, shinSeated);
  }
  return { bones, seated };
}

let loading: Promise<CharacterTemplate | null> | null = null;

/** One GLTF load for every agent. A failure resolves null so the blocky figure stays up. */
function loadCharacterTemplate(): Promise<CharacterTemplate | null> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const [{ GLTFLoader }, { clone }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/utils/SkeletonUtils.js'),
      ]);
      const gltf = await new GLTFLoader().loadAsync(CHARACTER_GLB_URL);
      const clips = new Map(gltf.animations.map(clip => [clip.name, clip] as const));
      return { scene: gltf.scene, clips, clone: source => clone(source) as Group };
    } catch (error) {
      console.warn(`Baked character ${CHARACTER_GLB_URL} failed to load; using the blocky figure.`, error);
      return null;
    }
  })();
  return loading;
}

function placeCharacter(clone: Group, body: Object3D) {
  body.updateWorldMatrix(true, false);
  scratchPosition.setFromMatrixPosition(body.matrixWorld);
  scratchEuler.setFromRotationMatrix(body.matrixWorld, 'YXZ');
  clone.position.copy(scratchPosition);
  clone.rotation.set(0, characterYaw(scratchEuler.y), 0);
}

/** Switches to `next`, cross-fading unless reduced motion asks for a still pose (`fadeLeft` tracks the fade). */
function play(puppet: Puppet, next: CharacterClip | null, reduced: boolean) {
  if (!puppet.mixer || next === puppet.current) return;
  const previous = puppet.current ? puppet.actions.get(puppet.current) : undefined;
  const action = next ? puppet.actions.get(next) : undefined;
  puppet.current = next;
  if (action) {
    action.reset();
    action.setLoop(LoopRepeat, Infinity);
    action.timeScale = next === 'walk' ? WALK_CLIP_SPEED : 1;
    action.play();
  }
  if (previous && action && !reduced) {
    previous.crossFadeTo(action, CLIP_FADE_SECONDS, false);
    puppet.fadeLeft = CLIP_FADE_SECONDS;
  } else {
    previous?.stop();
    puppet.fadeLeft = 0;
  }
}

function seatOf(object: Group): string | undefined {
  return (object.userData as { seatId?: string }).seatId;
}

/**
 * Opt-in stylized agents (`/office?art=baked`). Loads `character.glb` once, clones it per agent, shows the
 * accessories of the agent's role variant and tints the shirt. Clips follow the drawn avatar (view only):
 * walk while it moves, talk while the Play talk panel is open on it, type at its desk, idle otherwise. At its desk the
 * clone slides onto a chair at the keyboard (baked-seat.ts) and sits; while talking it turns to face the player. The
 * logical route anchor stays fixed; the avatar and clone share the visual seat tween.
 * The blocky figure stays until each clone is ready, and stays if the GLB fails; a GLB without clips stands still.
 */
export function BakedCharacters({ snapshot }: SceneMountProps) {
  const invalidate = useThree(state => state.invalidate);
  const scene = useThree(state => state.scene);
  const reduced = useReducedMotion();
  const templateRef = useRef<CharacterTemplate | null>(null);
  const clonesRef = useRef<Map<string, Puppet>>(new Map());
  const agentsRef = useRef(snapshot.agents);
  agentsRef.current = snapshot.agents;
  const [models, setModels] = useState<readonly { id: string; object: Group }[]>([]);
  const agentKey = snapshot.agents.map(agent => `${agent.id}:${agent.seatId}`).join('|');

  const publish = useCallback((template: CharacterTemplate) => {
    const agents = agentsRef.current;
    const map = clonesRef.current;
    const live = new Set(agents.map(agent => agent.id));
    for (const [id, puppet] of map) {
      if (live.has(id)) continue;
      disposePuppet(puppet);
      map.delete(id);
    }
    for (const agent of agents) syncClone(template, agent, map, scene);
    const next = agents.flatMap(agent => {
      const puppet = map.get(agent.id);
      return puppet ? [{ id: agent.id, object: puppet.object }] : [];
    });
    setModels(next);
    setBakedCharacterReady(next.map(model => model.id));
    invalidate();
  }, [invalidate, scene]);

  useEffect(() => {
    if (!bakedArtRequested(window.location.search)) return;
    let cancel = false;
    void loadCharacterTemplate().then(template => {
      if (cancel || !template) return;
      templateRef.current = template;
      publish(template);
    });
    return () => { cancel = true; };
  }, [publish]);

  useEffect(() => {
    const template = templateRef.current;
    if (template) publish(template);
  }, [agentKey, publish]);

  useEffect(() => () => {
    setBakedCharacterReady([]);
    for (const puppet of clonesRef.current.values()) disposePuppet(puppet);
    clonesRef.current.clear();
  }, []);

  // Opening or closing the talk panel needs one frame to start the switch; the fade then requests its own.
  useEffect(() => subscribeBakedTalking(() => invalidate()), [invalidate]);

  // Priority 0 keeps Fiber's automatic render (a positive priority would take it over); this mount
  // subscribes after the avatars, so it still runs after their pose writes. Idle and typing advance only on
  // frames something else asked for; frames are requested here only while a fade runs or the talk clip plays.
  useFrame(({ camera }, delta) => {
    if (clonesRef.current.size === 0) return;
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const step = reduced ? 0 : dt;
    const talking = bakedTalkingAgent();
    let again = false;
    for (const [id, puppet] of clonesRef.current) {
      const clone = puppet.object;
      const body = puppet.body;
      if (!body) { clone.visible = false; continue; }
      clone.visible = true;
      // Read the logical route from the animator: its visual slide must not trigger the walk clip.
      body.updateWorldMatrix(true, false);
      scratchPosition.setFromMatrixPosition(body.matrixWorld);
      scratchEuler.setFromRotationMatrix(body.matrixWorld, 'YXZ');
      const motion = body.userData.agentMotion as { x: number; z: number; moving: boolean; seated: number; mode: AgentMode } | undefined;
      const bx = motion?.x ?? scratchPosition.x, bz = motion?.z ?? scratchPosition.z, bodyHeading = scratchEuler.y;
      const moving = motion?.moving ?? (!!puppet.last && Math.hypot(bx - puppet.last[0], bz - puppet.last[1]) > STILL_EPSILON);
      const isTalking = talking === id || (motion ? facesPlayer(motion.mode) : false);
      if (puppet.last) { puppet.last[0] = bx; puppet.last[1] = bz; } else puppet.last = [bx, bz];
      const seatId = seatOf(clone) ?? '';
      const atDesk = atOwnDesk(seatId, bx, bz);
      const seat = puppet.legs && puppet.mixer ? puppet.deskSeat : null;
      const settle = puppet.seat;
      puppet.seat = seat ? stepSeatBlend(puppet.seat, atDesk && !moving && !isTalking, dt, reduced) : 0;
      const sit = seat ? motion?.seated ?? easeSeat(puppet.seat) : 0;
      clone.position.set(seat ? bx + (seat.x - bx) * sit : bx, SIT_LIFT_M * sit, seat ? bz + (seat.z - bz) * sit : bz);
      const target = isTalking ? headingToward(clone.position.x, clone.position.z, camera.position.x, camera.position.z)
        : seat && atDesk && !moving ? seat.heading : bodyHeading;
      puppet.heading = puppet.heading === null ? target : turnToward(puppet.heading, target, dt, reduced);
      clone.rotation.set(0, characterYaw(puppet.heading), 0);
      if (!reduced && (Math.abs(angleDelta(puppet.heading, target)) > TURN_EPSILON || puppet.seat !== settle)) again = true;
      if (!puppet.mixer) continue;
      scratchActivity.moving = moving;
      scratchActivity.talking = isTalking;
      scratchActivity.atDesk = atDesk;
      play(puppet, characterClip(scratchActivity, puppet.available), reduced);
      puppet.mixer.update(step);
      // The clip leaves the legs at rest (type, talk, idle); fold them onto the chair on top of it.
      if (puppet.legs && sit > 0) {
        for (let index = 0; index < puppet.legs.bones.length; index++) {
          puppet.legs.bones[index]!.quaternion.slerp(puppet.legs.seated[index]!, sit);
        }
      }
      puppet.fadeLeft = Math.max(0, puppet.fadeLeft - step);
      // A walk that just stopped needs one more frame to notice and fade out.
      if (!reduced && (moving || puppet.fadeLeft > 0 || puppet.current === 'talk')) again = true;
    }
    if (again) invalidate();
  });

  // A keyboard at each occupied desk; furniture already supplies the chair.
  const visible = visibleRooms(snapshot);
  const seatRooms = models.length === 0 ? '' : [...new Set(snapshot.agents.map(agent => agent.seatId))]
    .filter(room => isSeatDesk(room) && visible.includes(room)).sort().join(',');
  const keyboards = useMemo(() => seatRooms ? seatRooms.split(',').filter(isSeatDesk).flatMap(seatPieces) : [], [seatRooms]);

  return <>
    {models.map(model => <Fragment key={model.id}><primitive object={model.object} dispose={null} /><AvatarAnchors object={model.object} /></Fragment>)}
    {keyboards.length > 0 && <StaticBoxes pieces={keyboards} />}
  </>;
}

function disposePuppet(puppet: Puppet) {
  puppet.mixer?.stopAllAction();
  if (puppet.mixer) puppet.mixer.uncacheRoot(puppet.object);
  disposeClonedBody(puppet.object);
}

function syncClone(template: CharacterTemplate, agent: OfficeAgent, map: Map<string, Puppet>, scene: Object3D) {
  const current = map.get(agent.id);
  if (current && seatOf(current.object) === agent.seatId) {
    const body = scene.getObjectByName(`agent:${agent.id}`);
    current.body = body;
    if (body) placeCharacter(current.object, body);
    return;
  }
  if (current) disposePuppet(current);
  const object = template.clone(template.scene);
  object.name = `baked-character:${agent.id}`;
  object.visible = false;
  (object.userData as { seatId?: string }).seatId = agent.seatId;
  object.traverse(node => {
    // Walks with its agent: drawn by the per-frame contact-shadow pass, never baked.
    node.layers.enable(CONTACT_DYNAMIC_LAYER);
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned bounds come from the rest pose; animated limbs would otherwise pop at the frustum edge.
    if ((mesh as { isSkinnedMesh?: boolean }).isSkinnedMesh) mesh.frustumCulled = false;
  });
  applyCharacterVariant(object, characterVariant(agent.seatId));
  recolorBody(object, agentBodyColor(agent.seatId));
  const mixer = template.clips.size > 0 ? new AnimationMixer(object) : null;
  const actions = new Map<CharacterClip, AnimationAction>();
  if (mixer) {
    for (const name of CHARACTER_CLIPS) {
      const clip = template.clips.get(name);
      if (clip) actions.set(name, mixer.clipAction(clip));
    }
  }
  const body = scene.getObjectByName(`agent:${agent.id}`);
  if (body) {
    placeCharacter(object, body);
    object.visible = true;
  }
  map.set(agent.id, {
    object, body, deskSeat: deskSeat(agent.seatId), mixer: actions.size > 0 ? mixer : null,
    actions, available: new Set(actions.keys()), current: null, fadeLeft: 0, last: null,
    legs: seatedLegs(object), seat: 0, heading: null,
  });
}
