'use client';

import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import type { Group } from 'three';
import { bakedArtRequested, setBakedPieceReady } from '../../../lib/office/baked-art';
import { currentPropKitLayout, propkitPlacements, PROPKIT_GLB_URL } from '../../../lib/office/propkit';
import { buildPropKitBatch, buildPropKitFallback, disposePropKitSource, type PropKitBatch } from '../../../lib/office/propkit-render';
import { ContactDynamic } from '../ContactShadows';

/** Opt-in props own their fallback. Collision is flag-gated pure data, independent of this loader. */
export function PropKit() {
  const invalidate = useThree(state => state.invalidate);
  const canvas = useThree(state => state.gl.domElement);
  const [visual, setVisual] = useState<{ batch: PropKitBatch; ready: boolean } | null>(null);
  useEffect(() => {
    if (!bakedArtRequested(window.location.search)) return;
    const placements = propkitPlacements(currentPropKitLayout());
    const fallback = buildPropKitFallback(placements);
    setVisual({ batch: fallback, ready: false });
    let cancelled = false, source: Group | null = null, baked: PropKitBatch | null = null;
    void (async () => {
      try {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        if (cancelled) return;
        const gltf = await new GLTFLoader().loadAsync(PROPKIT_GLB_URL);
        if (cancelled) { disposePropKitSource(gltf.scene); return; }
        source = gltf.scene;
        baked = buildPropKitBatch(source, placements);
        setVisual({ batch: baked, ready: true });
        invalidate();
      } catch (error) {
        if (source) { disposePropKitSource(source); source = null; }
        if (!cancelled) console.warn(`Prop kit ${PROPKIT_GLB_URL} failed to load; using the procedural props.`, error);
      }
    })();
    return () => {
      cancelled = true; fallback.dispose(); baked?.dispose();
      if (source) disposePropKitSource(source);
    };
  }, [invalidate]);
  useEffect(() => {
    if (!visual) return;
    canvas.dataset.propkit = visual.ready ? 'ready' : 'fallback';
    canvas.dataset.propkitInstances = String(visual.batch.meshes.reduce((n, mesh) => n + mesh.count, 0));
    setBakedPieceReady('propkit', visual.ready);
    invalidate();
    return () => {
      setBakedPieceReady('propkit', false);
      delete canvas.dataset.propkit; delete canvas.dataset.propkitInstances;
    };
  }, [visual, canvas, invalidate]);
  if (!visual) return null;
  // This wrapper excludes the subtree from the static contact bake; castShadow=false
  // excludes every mesh from its dynamic pass too. Lighting is already in the atlas.
  return <ContactDynamic name='propkit'>{visual.batch.meshes.map(mesh =>
    <primitive key={mesh.uuid} object={mesh} dispose={null} />)}</ContactDynamic>;
}
