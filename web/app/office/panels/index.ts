/**
 * Play panel view registry: how PlayHud renders each target kind's dialog (data comes from
 * web/lib/office/targets). A new target with custom UI adds one file here and one line below.
 */
import type { PlayTarget } from '../../../lib/office/play';
import { deskPanel } from './DeskPanel';
import { handoffPanel } from './HandoffPanel';
import { paylinkPanel } from './PaylinkPanel';
import { serverPanel } from './ServerPanel';
import { treasuryPanel } from './TreasuryPanel';
import type { PlayPanelView } from './types';

export type { PlayPanelView } from './types';
export const PLAY_PANEL_VIEWS: Partial<Record<PlayTarget['kind'], PlayPanelView>> = {
  desk: deskPanel,
  handoff: handoffPanel,
  treasury: treasuryPanel,
  paylink: paylinkPanel,
  server: serverPanel,
};
