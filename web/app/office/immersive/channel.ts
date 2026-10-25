/**
 * Tiny mutable channel between the lazy Play rig (scene bundle) and the immersive audio (HUD bundle).
 * Plain fields, so the rig writes it from useFrame without allocating.
 */
export const immersiveChannel = {
  /** Actual walking speed (m/s) at the last footfall. */
  speed: 0,
  /** True while the immersive engine is running and plays footsteps with the floor's timbre (the plain step cue then stays quiet). */
  footsteps: false,
};
