'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';
import type { Group, Material, Object3D } from 'three';
import { visibleRooms, type AnchorId } from '../../../lib/office/state';
import {
  DESKKIT_GLB_URL, DESKKIT_TINT_MATERIAL, deskKitPlacements, deskKitReady, missingKitNodes, setDeskKitReady, subscribeDeskKit,
} from '../../../lib/office/deskkit';
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
        for (const node of gltf.scene.children) {
          node.traverse(child => { const mesh = child as MeshLike; if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; } });
          map.set(node.name, node);
        }
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
 * Opt-in desk kit (`?art=baked`): clones named deskkit.glb props onto the procedural anchors (lib/office/deskkit.ts).
 * Publishes the ready flag that hides the replaced procedural pieces only after every clone exists, so a missing or
 * partial GLB leaves the procedural props in place. Lit live, like the baked characters.
 */
export function DeskKit({ snapshot }: SceneMountProps) {
  const [requested, setRequested] = useState(false);
  useEffect(() => { setRequested(bakedArtRequested(window.location.search)); }, []);
  const templates = useKitTemplates(requested);
  const invalidate = useThree(state => state.invalidate);
  const roomsKey = visibleRooms(snapshot).join(',');
  const placed = useMemo(() => {
    if (!templates) return null;
    const placements = deskKitPlacements(roomsKey ? roomsKey.split(',') as AnchorId[] : []);
    if (missingKitNodes(placements, new Set(templates.keys())).length) return null;
    const owned: Material[] = [];
    const objects = placements.map(placement => {
      const object = templates.get(placement.node)!.clone(true);
      object.name = `deskkit:${placement.id}`;
      object.position.set(...placement.at);
      object.rotation.set(0, placement.rotationY, 0);
      if (placement.scale) object.scale.set(...placement.scale);
      if (placement.tint) {
        object.traverse(child => {
          const mesh = child as MeshLike;
          if (!mesh.isMesh || !mesh.material) return;
          const swap = (m: Material) => {
            if (m.name !== DESKKIT_TINT_MATERIAL || !('color' in m)) return m;
            const copy = m.clone();
            (copy as Material & { color: { set(c: string): void } }).color.set(placement.tint!);
            owned.push(copy);
            return copy;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
        });
      }
      return { id: placement.id, object };
    });
    return { objects, owned };
  }, [templates, roomsKey]);
  useEffect(() => {
    if (!placed) return;
    setDeskKitReady(true);
    invalidate();
    return () => { setDeskKitReady(false); placed.owned.forEach(m => m.dispose()); };
  }, [placed, invalidate]);
  if (!placed) return null;
  return <group name='deskkit'>{placed.objects.map(({ id, object }) => <primitive key={id} object={object} dispose={null} />)}</group>;
}
