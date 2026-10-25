'use client';

import { useLayoutEffect, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import type { Object3D } from 'three';

/**
 * Compiles the shaders of a group that starts hidden (first-person-only geometry), so entering Play does not
 * stall on its first frame. Shows the group for one synchronous compile with the scene's lights, then restores it.
 */
export function usePrecompile(group: RefObject<Object3D | null>) {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  useLayoutEffect(() => {
    const target = group.current;
    if (!target || target.visible) return;
    target.visible = true;
    try { gl.compile(scene, camera); } catch { /* best effort: the first visible frame compiles instead */ }
    target.visible = false;
    // Only once per mount; later camera swaps reuse the compiled programs.
  }, [gl, scene]);
}
