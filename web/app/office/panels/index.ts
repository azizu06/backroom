/**
 * Play panel view registry: how PlayHud renders each target kind's dialog (data comes from
 * web/lib/office/targets). A new target with custom UI adds one file here and one line below.
 */
import type { PlayTarget } from '../../../lib/office/play';
import { coworkerPanel } from './CoworkerPanel';
import { deskPanel } from './DeskPanel';
import { inboxPanel } from './InboxPanel';
import { paylinkPanel } from './PaylinkPanel';
import { phonePanel } from './PhonePanel';
import { serverPanel } from './ServerPanel';
import { treasuryPanel } from './TreasuryPanel';
import type { PlayPanelView } from './types';

export type { PlayPanelView } from './types';
export const PLAY_PANEL_VIEWS: Partial<Record<PlayTarget['kind'], PlayPanelView>> = {
  desk: deskPanel,
  treasury: treasuryPanel,
  paylink: paylinkPanel,
  server: serverPanel,
  phone: phonePanel,
  coworker: coworkerPanel,
  inbox: inboxPanel,
};
