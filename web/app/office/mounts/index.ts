/**
 * Scene mount registry (lazy scene bundle only). A new piece of the 3D office adds one file in this
 * folder (a component taking SceneMountProps) and one entry below. Order is draw order.
 */
import { OfficeProps } from '../props/OfficeProps';
import { BakedArt } from './BakedArt';
import { BakedCharacters } from './BakedCharacters';
import { LobbyInbox } from '../props/LobbyInbox';
import { ReceiptPrinter } from '../props/ReceiptPrinter';
import { LobbyDenyStamp } from '../props/LobbyDenyStamp';
import { AuditWallMount } from './AuditWallMount';
import { Desks } from './Desks';
import { Doors } from './Doors';
import { InteractiveDoors } from './InteractiveDoors';
import { CarryFolder } from './CarryFolder';
import { HandoffMount } from './HandoffMount';
import { InboxTrayMount } from './InboxTrayMount';
import { LobbyCounter } from './LobbyCounter';
import { Plants } from './Plants';
import { RoomDetail } from './RoomDetail';
import { Performance } from './Performance';
import { ServerRoomMount } from './ServerRoomMount';
import { TreasuryVault } from './TreasuryVault';
import type { SceneMount } from './types';

export type { SceneMount, SceneMountProps } from './types';
export const SCENE_MOUNTS: readonly SceneMount[] = [
  { id: 'doors', instanced: true, Component: Doors },
  { id: 'interactive-doors', instanced: false, Component: InteractiveDoors },
  { id: 'carry-folder', instanced: false, Component: CarryFolder },
  { id: 'desks', instanced: true, Component: Desks },
  { id: 'lobby-counter', instanced: true, Component: LobbyCounter },
  { id: 'treasury-vault', instanced: true, Component: TreasuryVault },
  { id: 'plants', instanced: true, Component: Plants },
  { id: 'room-detail', instanced: false, Component: RoomDetail },
  { id: 'server-room', instanced: false, Component: ServerRoomMount },
  { id: 'baked-art', instanced: false, Component: BakedArt },
  { id: 'baked-characters', instanced: false, Component: BakedCharacters },
  { id: 'audit-wall', instanced: false, Component: AuditWallMount },
  { id: 'inbox-tray', instanced: false, Component: InboxTrayMount },
  { id: 'props', instanced: false, Component: OfficeProps },
  { id: 'lobby-inbox', instanced: false, Component: LobbyInbox },
  { id: 'receipt-printer', instanced: false, Component: ReceiptPrinter },
  { id: 'lobby-deny-stamp', instanced: false, Component: LobbyDenyStamp },
  { id: 'handoffs', instanced: false, Component: HandoffMount },
  { id: 'performance', instanced: false, Component: Performance },
];
