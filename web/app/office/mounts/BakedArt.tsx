'use client';

import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { MeshBasicMaterial, type Group, type Material, type Texture } from 'three';
import type { SceneMountProps } from './types';

/**
 * Opt-in Blender layer (`/office?art=baked`): baked, bevelled room shells from tools/bake, drawn over the
 * procedural scene. Off by default. Any load error leaves the procedural scene untouched.
 */
const ROOMS = [{ id: 'lobby', url: '/office-art/lobby.glb' }] as const;
/** Pieces that block the overview camera; kept for first-person Play, hidden when the camera is orthographic. */
const HIDDEN_IN_OVERVIEW = new Set(['ceiling', 'wall_near']);

/** True for `?art=baked`. Pure so it is testable. */
export function bakedArtRequested(search: string): boolean {
  return new URLSearchParams(search).get('art') === 'baked';
}

function BakedRoom({ url, overview }: { url: string; overview: boolean }) {
  const invalidate = useThree(state => state.invalidate);
  const [scene, setScene] = useState<Group | null>(null);
  useEffect(() => {
    let cancelled = false;
    const disposables: { dispose(): void }[] = [];
    (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().loadAsync(url);
        if (cancelled) return;
        // The lightmap holds the full lighting, so draw it unlit and untonemapped to match what was baked.
        const materials = new Map<Material, MeshBasicMaterial>();
        gltf.scene.traverse(node => {
          const mesh = node as { isMesh?: boolean; material?: Material & { map?: Texture | null }; castShadow: boolean; receiveShadow: boolean };
          if (!mesh.isMesh || !mesh.material) return;
          const source = mesh.material;
          if (!materials.has(source)) {
            const basic = new MeshBasicMaterial({ map: source.map ?? null, toneMapped: false });
            materials.set(source, basic);
            disposables.push(basic, source);
            if (source.map) disposables.push(source.map);
          }
          mesh.material = materials.get(source)!;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        });
        gltf.scene.traverse(node => { if ('geometry' in node) disposables.push((node as unknown as { geometry: { dispose(): void } }).geometry); });
        setScene(gltf.scene);
        invalidate();
      } catch (error) {
        console.warn(`Baked art ${url} failed to load; using the procedural scene.`, error);
      }
    })();
    return () => { cancelled = true; setScene(null); disposables.forEach(item => item.dispose()); };
  }, [url, invalidate]);
  useEffect(() => {
    scene?.traverse(node => { if (HIDDEN_IN_OVERVIEW.has(node.name)) node.visible = !overview; });
    invalidate();
  }, [scene, overview, invalidate]);
  return scene ? <primitive object={scene} dispose={null} /> : null;
}

export function BakedArt(_props: SceneMountProps) {
  const [requested, setRequested] = useState(false);
  useEffect(() => { setRequested(bakedArtRequested(window.location.search)); }, []);
  const overview = useThree(state => (state.camera as { isOrthographicCamera?: boolean }).isOrthographicCamera === true);
  if (!requested) return null;
  return <>{ROOMS.map(room => <BakedRoom key={room.id} url={room.url} overview={overview} />)}</>;
}
