'use client';

import type { OfficeSnapshot } from '../../../lib/office/state';
import { Ambient } from './Ambient';
import { RoomDressing } from './RoomDressing';
import { TreasuryDeny } from './TreasuryDeny';
import { ContactDynamic } from '../ContactShadows';
import { DeskMonitors } from './DeskMonitors';
import { WallClock } from './WallClock';
import { Whiteboard } from './Whiteboard';
import { DeskPhone } from './DeskPhone';

/**
 * View-only office props; they read the snapshot and never decide anything.
 * Each prop's interaction lives in web/lib/office/props and is listed in OFFICE_PROP_INTERACTIONS.
 * A new prop adds one line here.
 */
export function OfficeProps({ snapshot }: { snapshot: OfficeSnapshot }) {
  return <>
    <Whiteboard snapshot={snapshot} />
    <WallClock snapshot={snapshot} />
    <Ambient snapshot={snapshot} />
    <RoomDressing snapshot={snapshot} />
    <ContactDynamic name='prop:treasury-deny-moment'><TreasuryDeny snapshot={snapshot} /></ContactDynamic>
    <DeskMonitors snapshot={snapshot} />
    <DeskPhone snapshot={snapshot} />
  </>;
}
