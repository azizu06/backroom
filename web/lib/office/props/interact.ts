import type { FloorPosition, OfficeSnapshot } from '../state';

export interface PropPanelRow { label: string; value: string }
export interface PropPanel { title: string; rows: readonly PropPanelRow[] }

/** Pure, three-free description of a prop a future Play mode can target ("E · <prompt>"). Read-only view data. */
export interface OfficePropInteraction {
  id: string;
  prompt: string;
  /** Floor (x, z) where the prop stands, for range checks. */
  position: FloorPosition;
  /** Interaction radius around position, in floor units. */
  radius: number;
  visible(snapshot: OfficeSnapshot): boolean;
  /** Plain display data only. */
  panel(snapshot: OfficeSnapshot, now: number): PropPanel;
}
