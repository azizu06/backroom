'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useThree } from '@react-three/fiber';
import { MeshBasicMaterial, type Group, type Material, type Texture, type Mesh } from 'three';
import type { SceneMountProps } from './types';
import { useDetailLayer } from './StaticGeometry';
import { BAKED_ROOMS, HALL_NODES, HIDDEN_IN_OVERVIEW, bakedArtRequested, bakedPieceActive, setBakedPieceReady, subscribeBakedReady, validateHallColliders } from '../../../lib/office/baked-art';

export { bakedArtRequested };

/**
 * True only while `?art=baked` is on AND the baked lobby GLB is in the scene. Every procedural replacement, hide and
 * collider change keys off this, so a failed load (404, bad file) leaves the procedural lobby whole.
 */
export function useBakedLobbyReady(): boolean {
  return useSyncExternalStore(subscribeBakedReady, () => bakedPieceActive(window.location.search, 'lobby'), () => false);
}

export function useBakedHallReady(): boolean {
  return useSyncExternalStore(subscribeBakedReady, () => bakedPieceActive(window.location.search, 'hall'), () => false);
}

/**
 * Opt-in Blender layer (`/office?art=baked`): baked, bevelled room shells from tools/bake, drawn over the
 * procedural scene. Off by default. Any load error leaves the procedural scene untouched.
 */
export const ROOMS = BAKED_ROOMS;

function BakedRoom({ id, url, collidersUrl, overview }: { id: string; url: string; collidersUrl: string | null; overview: boolean }) {
  const invalidate = useThree(state => state.invalidate);
  const [scene, setScene] = useState<Group | null>(null);
  const root = useRef<Group>(null);
  // Contact shadows override materials and ignore castShadow; their cameras must skip this layer too.
  useDetailLayer(root, scene);
  useEffect(() => {
    let cancelled = false;
    const disposables = new Set<{ dispose(): void }>();
    const dispose = () => { disposables.forEach(item => item.dispose()); disposables.clear(); };
    (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        if (cancelled) return;
        const gltf = await new GLTFLoader().loadAsync(url);
        // The lightmap holds the full lighting, so draw it unlit and untonemapped to match what was baked.
        const materials = new Map<Material, MeshBasicMaterial>();
        gltf.scene.traverse(node => {
          const mesh = node as Mesh;
          if (!mesh.isMesh || !mesh.material) return;
          const convert = (source: Material & { map?: Texture | null }) => {
            if (!materials.has(source)) {
              const basic = new MeshBasicMaterial({ map: source.map ?? null, toneMapped: false, side: source.side });
              materials.set(source, basic);
              disposables.add(basic); disposables.add(source);
              if (source.map) disposables.add(source.map);
            }
            return materials.get(source)!;
          };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(convert) : convert(mesh.material);
          disposables.add(mesh.geometry);
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        });
        if (cancelled) { dispose(); return; }
        if (id === 'hall' && HALL_NODES.some(name => {
          const node = gltf.scene.getObjectByName(name);
          return !node || (name !== 'walls' && !(node as Mesh).isMesh);
        })) throw new Error('hall is missing required mesh nodes');
        if (collidersUrl) {
          const response = await fetch(collidersUrl);
          if (!response.ok) throw new Error('hall collider file failed to load');
          validateHallColliders(await response.json());
        }
        if (cancelled) { dispose(); return; }
        setScene(gltf.scene);
        invalidate();
      } catch (error) {
        dispose();
        if (cancelled) return;
        setBakedPieceReady(id, false);
        console.warn(`Baked art ${url} failed to load; using the procedural scene.`, error);
      }
    })();
    return () => { cancelled = true; dispose(); };
  }, [id, url, collidersUrl, invalidate]);
  // Ready only once the primitive is committed into the scene graph (passive effects run after R3F attaches it).
  useEffect(() => {
    if (!scene) return;
    setBakedPieceReady(id, true);
    return () => setBakedPieceReady(id, false);
  }, [id, scene]);
  useEffect(() => {
    scene?.traverse(node => { if (HIDDEN_IN_OVERVIEW.has(node.name)) node.visible = !overview; });
    invalidate();
  }, [scene, overview, invalidate]);
  return scene ? <primitive ref={root} object={scene} dispose={null} /> : null;
}

export function BakedArt(_props: SceneMountProps) {
  const [requested, setRequested] = useState(false);
  useEffect(() => { setRequested(bakedArtRequested(window.location.search)); }, []);
  const overview = useThree(state => (state.camera as { isOrthographicCamera?: boolean }).isOrthographicCamera === true);
  const canvas = useThree(state => state.gl.domElement);
  const hallReady = useBakedHallReady();
  // Diagnostics on the existing canvas, also used by the browser fallback check.
  useEffect(() => {
    canvas.dataset.bakedHall = hallReady ? 'ready' : 'fallback';
    return () => { delete canvas.dataset.bakedHall; };
  }, [canvas, hallReady]);
  if (!requested) return null;
  return <>{ROOMS.filter(room => !room.playOnly || !overview).map(room => <BakedRoom key={room.id} {...room} overview={overview} />)}</>;
}
