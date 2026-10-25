'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Euler, Vector3, type Group, type Mesh, type Object3D } from 'three';
import { bakedArtRequested } from '../../../lib/office/baked-art';
import {
  CHARACTER_GLB_URL, agentBodyColor, characterYaw, disposeClonedBody, recolorBody, setBakedCharacterReady,
} from '../../../lib/office/baked-character';
import type { OfficeAgent } from '../../../lib/office/state';
import type { SceneMountProps } from './types';

const scratchPosition = new Vector3();
const scratchEuler = new Euler();

let loading: Promise<Group | null> | null = null;

/** One GLTF load for every agent. A failure resolves null so the blocky figure stays up. */
function loadCharacterTemplate(): Promise<Group | null> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(CHARACTER_GLB_URL);
      return gltf.scene;
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

function seatOf(object: Group): string | undefined {
  return (object.userData as { seatId?: string }).seatId;
}

/**
 * Opt-in stylized agents (`/office?art=baked`). Loads `character.glb` once, clones it per agent and
 * tints the shirt. The blocky figure stays until each clone is ready, and stays if the GLB fails.
 */
export function BakedCharacters({ snapshot }: SceneMountProps) {
  const invalidate = useThree(state => state.invalidate);
  const scene = useThree(state => state.scene);
  const templateRef = useRef<Group | null>(null);
  const clonesRef = useRef<Map<string, Group>>(new Map());
  const agentsRef = useRef(snapshot.agents);
  agentsRef.current = snapshot.agents;
  const [models, setModels] = useState<readonly { id: string; object: Group }[]>([]);
  const agentKey = snapshot.agents.map(agent => `${agent.id}:${agent.seatId}`).join('|');

  const publish = useCallback((template: Group) => {
    const agents = agentsRef.current;
    const map = clonesRef.current;
    const live = new Set(agents.map(agent => agent.id));
    for (const [id, object] of map) {
      if (live.has(id)) continue;
      disposeClonedBody(object);
      map.delete(id);
    }
    for (const agent of agents) syncClone(template, agent, map, scene);
    const next = agents.flatMap(agent => {
      const object = map.get(agent.id);
      return object ? [{ id: agent.id, object }] : [];
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
    for (const object of clonesRef.current.values()) disposeClonedBody(object);
    clonesRef.current.clear();
  }, []);

  // Priority 0 keeps Fiber's automatic render (a positive priority would take it over); this mount
  // subscribes after the avatars, so it still runs after their pose writes. Idle frames are not requested here.
  useFrame(() => {
    if (clonesRef.current.size === 0) return;
    for (const [id, clone] of clonesRef.current) {
      const body = scene.getObjectByName(`agent:${id}`);
      if (!body) { clone.visible = false; continue; }
      placeCharacter(clone, body);
      clone.visible = true;
    }
  });

  return <>{models.map(model => <primitive key={model.id} object={model.object} dispose={null} />)}</>;
}

function syncClone(template: Group, agent: OfficeAgent, map: Map<string, Group>, scene: Object3D) {
  const current = map.get(agent.id);
  if (current && seatOf(current) === agent.seatId) {
    const body = scene.getObjectByName(`agent:${agent.id}`);
    if (body) placeCharacter(current, body);
    return;
  }
  if (current) disposeClonedBody(current);
  const object = template.clone(true);
  object.name = `baked-character:${agent.id}`;
  object.visible = false;
  (object.userData as { seatId?: string }).seatId = agent.seatId;
  object.traverse(node => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  recolorBody(object, agentBodyColor(agent.seatId));
  const body = scene.getObjectByName(`agent:${agent.id}`);
  if (body) {
    placeCharacter(object, body);
    object.visible = true;
  }
  map.set(agent.id, object);
}
