/**
 * Scene mount registry (lazy scene bundle only). A new piece of the 3D office adds one file in this
 * folder (a component taking SceneMountProps) and one entry below. Order is draw order.
 */
import { OfficeProps } from '../props/OfficeProps';
import { LobbyInbox } from '../props/LobbyInbox';
import { ReceiptPrinter } from '../props/ReceiptPrinter';
import { LobbyDenyStamp } from '../props/LobbyDenyStamp';
import { Desks } from './Desks';
import { Doors } from './Doors';
import { LobbyCounter } from './LobbyCounter';
import { Plants } from './Plants';
import { Performance } from './Performance';
import { ServerRoomMount } from './ServerRoomMount';
import { TreasuryVault } from './TreasuryVault';
import type { SceneMount } from './types';

export type { SceneMount, SceneMountProps } from './types';
export const SCENE_MOUNTS: readonly SceneMount[] = [
  { id: 'doors', instanced: true, Component: Doors },
  { id: 'desks', instanced: true, Component: Desks },
  { id: 'lobby-counter', instanced: true, Component: LobbyCounter },
  { id: 'treasury-vault', instanced: true, Component: TreasuryVault },
  { id: 'plants', instanced: true, Component: Plants },
  { id: 'server-room', instanced: false, Component: ServerRoomMount },
  { id: 'props', instanced: false, Component: OfficeProps },
  { id: 'lobby-inbox', instanced: false, Component: LobbyInbox },
  { id: 'receipt-printer', instanced: false, Component: ReceiptPrinter },
  { id: 'lobby-deny-stamp', instanced: false, Component: LobbyDenyStamp },
  { id: 'performance', instanced: false, Component: Performance },
];
