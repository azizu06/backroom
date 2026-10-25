import type { ComponentType } from 'react';
import type { OfficeSnapshot } from '../../../lib/office/state';

/** Everything a scene mount receives. Mounts are view-only: they read the snapshot and never decide anything. */
export interface SceneMountProps { readonly snapshot: OfficeSnapshot }
export interface SceneMount {
  /** Stable React key. */
  readonly id: string;
  /**
   * true: drawn inside the scene's shared box <Instances>, so it may use Block (cheap, one draw call).
   * false: drawn after it, for pieces with their own meshes and materials.
   */
  readonly instanced: boolean;
  /** Non-instanced mounts that move (doors, carried folders, handoff walkers): their contact shadow redraws every frame. */
  readonly moving?: boolean;
  readonly Component: ComponentType<SceneMountProps>;
}
