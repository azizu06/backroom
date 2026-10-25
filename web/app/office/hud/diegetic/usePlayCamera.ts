'use client';

import { useThree } from '@react-three/fiber';

/** Play is the only view with a perspective camera (PlayRig); the overview cameras are orthographic. */
export function usePlayCamera(): boolean {
  return useThree(state => 'isPerspectiveCamera' in state.camera && state.camera.isPerspectiveCamera === true);
}
