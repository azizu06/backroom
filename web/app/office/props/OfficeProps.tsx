'use client';

import type { OfficeSnapshot } from '../../../lib/office/state';
import { WallClock } from './WallClock';
import { Whiteboard } from './Whiteboard';

/**
 * View-only office props; they read the snapshot and never decide anything.
 * Each prop's interaction lives in web/lib/office/props and is listed in OFFICE_PROP_INTERACTIONS.
 * A new prop adds one line here.
 */
export function OfficeProps({ snapshot }: { snapshot: OfficeSnapshot }) {
  return <>
    <Whiteboard snapshot={snapshot} />
    <WallClock snapshot={snapshot} />
  </>;
}
