/**
 * Scene mount registry (lazy scene bundle only). A new piece of the 3D office adds one file in this
 * folder (a component taking SceneMountProps) and one entry below. Order is draw order.
 */
import { OfficeProps } from '../props/OfficeProps';
import { BakedCharacters } from './BakedCharacters';
import { LobbyInbox } from '../props/LobbyInbox';
import { ReceiptPrinter } from '../props/ReceiptPrinter';
import { LobbyDenyStamp } from '../props/LobbyDenyStamp';
import { AuditWallMount } from './AuditWallMount';
import { DeskKit, DeskKitDesks as Desks } from './DeskKit';
import { CarryFolder } from './CarryFolder';
import { HandoffMount } from './HandoffMount';
import { InboxTrayMount } from './InboxTrayMount';
import { LobbyCounter } from './LobbyCounter';
import { Plants } from './Plants';
import { Performance } from './Performance';
import { ServerRoomMount } from './ServerRoomMount';
import { TreasuryVault } from './TreasuryVault';
import { Outdoors } from './Outdoors';
import { WorldShell } from './WorldShell';
import { AgentCardAnchor } from '../hud/diegetic/AgentCardAnchor';
import { DeskStatusPlates } from '../hud/diegetic/DeskStatusPlates';
import { LobbyNoticeBoard } from '../hud/diegetic/LobbyNoticeBoard';
import type { SceneMount } from './types';

export type { SceneMount, SceneMountProps } from './types';
export const SCENE_MOUNTS: readonly SceneMount[] = [
  { id: 'outdoors', instanced: false, Component: Outdoors },
  { id: 'world-shell', instanced: false, Component: WorldShell },
  { id: 'carry-folder', instanced: false, moving: true, Component: CarryFolder },
  { id: 'desks', instanced: true, Component: Desks },
  { id: 'lobby-counter', instanced: true, Component: LobbyCounter },
  { id: 'treasury-vault', instanced: true, Component: TreasuryVault },
  { id: 'plants', instanced: true, Component: Plants },
  { id: 'server-room', instanced: false, Component: ServerRoomMount },
  { id: 'desk-kit', instanced: false, Component: DeskKit },
  { id: 'baked-characters', instanced: false, moving: true, Component: BakedCharacters },
  { id: 'audit-wall', instanced: false, Component: AuditWallMount },
  { id: 'inbox-tray', instanced: false, Component: InboxTrayMount },
  { id: 'props', instanced: false, Component: OfficeProps },
  { id: 'lobby-inbox', instanced: false, Component: LobbyInbox },
  { id: 'receipt-printer', instanced: false, Component: ReceiptPrinter },
  { id: 'lobby-deny-stamp', instanced: false, Component: LobbyDenyStamp },
  { id: 'handoffs', instanced: false, moving: true, Component: HandoffMount },
  { id: 'performance', instanced: false, Component: Performance },
  // HUD variant (c), diegetic: Play-only in-world status (hud/diegetic).
  { id: 'hud-desk-plates', instanced: false, Component: DeskStatusPlates },
  { id: 'hud-notice-board', instanced: false, Component: LobbyNoticeBoard },
  { id: 'hud-agent-card', instanced: false, Component: AgentCardAnchor },
];
