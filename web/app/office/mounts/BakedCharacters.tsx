'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AnimationMixer, Euler, LoopRepeat, Vector3, type AnimationAction, type AnimationClip, type Group, type Mesh, type Object3D,
} from 'three';
import { bakedArtRequested } from '../../../lib/office/baked-art';
import {
  CHARACTER_CLIPS, CHARACTER_GLB_URL, CLIP_FADE_SECONDS, WALK_CLIP_SPEED, agentBodyColor, applyCharacterVariant, atOwnDesk, bakedTalkingAgent,
  characterClip, characterVariant, characterYaw, disposeClonedBody, recolorBody, setBakedCharacterReady, subscribeBakedTalking,
  type CharacterClip,
} from '../../../lib/office/baked-character';
import type { OfficeAgent } from '../../../lib/office/state';
import { useReducedMotion } from './shared';
import type { SceneMountProps } from './types';

const scratchPosition = new Vector3();
const scratchEuler = new Euler();
/** Below this per-frame travel (m) the avatar counts as standing. */
const STILL_EPSILON = 0.0005;

interface CharacterTemplate {
  readonly scene: Group;
  readonly clips: ReadonlyMap<string, AnimationClip>;
  /** Skeleton-aware clone (each agent gets its own bones). */
  readonly clone: (source: Group) => Group;
}

/** One clone's playback. `mixer` is null when the GLB has no clips: the clone keeps its rest pose. */
interface Puppet {
  readonly object: Group;
  readonly mixer: AnimationMixer | null;
  readonly actions: Map<CharacterClip, AnimationAction>;
  readonly available: ReadonlySet<string>;
  current: CharacterClip | null;
  fadeLeft: number;
  last: [number, number] | null;
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
 * walk while it moves, talk while the Play talk panel is open on it, type at its desk, idle otherwise.
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
  useFrame((_, delta) => {
    if (clonesRef.current.size === 0) return;
    const step = reduced ? 0 : Math.min(Math.max(delta, 0), 0.1);
    const talking = bakedTalkingAgent();
    const seats = new Map(agentsRef.current.map(agent => [agent.id, agent.seatId] as const));
    let again = false;
    for (const [id, puppet] of clonesRef.current) {
      const clone = puppet.object;
      const body = scene.getObjectByName(`agent:${id}`);
      if (!body) { clone.visible = false; continue; }
      placeCharacter(clone, body);
      clone.visible = true;
      if (!puppet.mixer) continue;
      const x = clone.position.x, z = clone.position.z;
      const moving = !!puppet.last && Math.hypot(x - puppet.last[0], z - puppet.last[1]) > STILL_EPSILON;
      puppet.last = [x, z];
      const activity = { moving, talking: talking === id, atDesk: atOwnDesk(seats.get(id) ?? '', x, z) };
      play(puppet, characterClip(activity, puppet.available), reduced);
      puppet.mixer.update(step);
      puppet.fadeLeft = Math.max(0, puppet.fadeLeft - step);
      // A walk that just stopped needs one more frame to notice and fade out.
      if (!reduced && (moving || puppet.fadeLeft > 0 || puppet.current === 'talk')) again = true;
    }
    if (again) invalidate();
  });

  return <>{models.map(model => <primitive key={model.id} object={model.object} dispose={null} />)}</>;
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
    if (body) placeCharacter(current.object, body);
    return;
  }
  if (current) disposePuppet(current);
  const object = template.clone(template.scene);
  object.name = `baked-character:${agent.id}`;
  object.visible = false;
  (object.userData as { seatId?: string }).seatId = agent.seatId;
  object.traverse(node => {
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
  map.set(agent.id, { object, mixer: actions.size > 0 ? mixer : null, actions, available: new Set(actions.keys()), current: null, fadeLeft: 0, last: null });
}
