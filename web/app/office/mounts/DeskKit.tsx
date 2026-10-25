'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';
import type { Group, Material, Object3D } from 'three';
import { visibleRooms, type AnchorId } from '../../../lib/office/state';
import {
  DESKKIT_GLB_URL, deskKitPlacements, deskKitReady, missingKitNodes, setDeskKitReady, subscribeDeskKit,
} from '../../../lib/office/deskkit';
import { buildDeskKitBatch } from '../../../lib/office/deskkit-merge';
import { bakedArtRequested } from '../../../lib/office/baked-art';
import type { SceneMountProps } from './types';

/** True once deskkit.glb has loaded with every node the placements need (only ever under `?art=baked`). */
export function useDeskKitReady(): boolean {
  return useSyncExternalStore(subscribeDeskKit, deskKitReady, () => false);
}

type MeshLike = Object3D & { isMesh?: boolean; material?: Material | Material[]; geometry?: { dispose(): void } };

/** Loads the kit once; null until loaded, and stays null on any error (procedural props stay). */
function useKitTemplates(enabled: boolean): Map<string, Object3D> | null {
  const invalidate = useThree(state => state.invalidate);
  const [templates, setTemplates] = useState<Map<string, Object3D> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let loaded: Group | null = null;
    (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().loadAsync(DESKKIT_GLB_URL);
        loaded = gltf.scene;
        if (cancelled) return;
        const map = new Map<string, Object3D>();
        for (const node of gltf.scene.children) map.set(node.name, node);
        setTemplates(map);
        invalidate();
      } catch (error) {
        console.warn(`Desk kit ${DESKKIT_GLB_URL} failed to load; using the procedural props.`, error);
      }
    })();
    return () => {
      cancelled = true;
      setTemplates(null);
      loaded?.traverse(node => {
        const mesh = node as MeshLike;
        mesh.geometry?.dispose();
        (Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []).forEach(m => m.dispose());
      });
    };
  }, [enabled, invalidate]);
  return templates;
}

/**
 * Opt-in desk kit (`?art=baked`): places named deskkit.glb props on the procedural anchors (lib/office/deskkit.ts),
 * merged into one static mesh per kit material (lib/office/deskkit-merge.ts) so draw calls do not grow with the
 * number of placements. Publishes the ready flag that hides the replaced procedural pieces only after the batch
 * exists, so a missing or partial GLB leaves the procedural props in place. Lit live, like the baked characters.
 */
export function DeskKit({ snapshot }: SceneMountProps) {
  const [requested, setRequested] = useState(false);
  useEffect(() => { setRequested(bakedArtRequested(window.location.search)); }, []);
  const templates = useKitTemplates(requested);
  const invalidate = useThree(state => state.invalidate);
  const canvas = useThree(state => state.gl.domElement);
  const roomsKey = visibleRooms(snapshot).join(',');
  const placed = useMemo(() => {
    if (!templates) return null;
    const placements = deskKitPlacements(roomsKey ? roomsKey.split(',') as AnchorId[] : []);
    if (missingKitNodes(placements, new Set(templates.keys())).length) return null;
    try {
      return buildDeskKitBatch(templates, placements);
    } catch (error) {
      console.warn('Desk kit could not be batched; using the procedural props.', error);
      return null;
    }
  }, [templates, roomsKey]);
  useEffect(() => {
    if (!placed) return;
    setDeskKitReady(true);
    canvas.dataset.deskkit = 'ready';
    invalidate();
    return () => { setDeskKitReady(false); delete canvas.dataset.deskkit; placed.dispose(); };
  }, [placed, invalidate, canvas]);
  if (!placed) return null;
  return <group name='deskkit'>{placed.meshes.map(mesh => <primitive key={mesh.uuid} object={mesh} dispose={null} />)}</group>;
}
