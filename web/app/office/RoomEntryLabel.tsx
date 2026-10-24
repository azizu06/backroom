'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { ROOM_ENTRY_MS, roomAt } from '../../lib/office/room-entry';
import { OFFICE_ANCHORS, visibleRooms, type AnchorId, type OfficeSnapshot } from '../../lib/office/state';
import './room-entry.css';

/** Observes the rig's pose, without polling or importing the lazy scene. */
export function RoomEntryLabel({ hud, snapshot }: { hud: RefObject<HTMLElement | null>; snapshot: OfficeSnapshot }) {
  const current = useRef<AnchorId | null>(null);
  const sequence = useRef(0);
  const [entry, setEntry] = useState<{ room: AnchorId; id: number } | null>(null);
  const roomsKey = visibleRooms(snapshot).join(',');

  useEffect(() => {
    const surface = hud.current;
    if (!surface) return;
    const rooms = roomsKey ? roomsKey.split(',') as AnchorId[] : [];
    function readPose() {
      const { playerX, playerZ } = surface!.dataset;
      if (playerX === undefined || playerZ === undefined) return;
      const x = Number(playerX), z = Number(playerZ);
      if (!Number.isFinite(x) || !Number.isFinite(z)) return;
      const next = roomAt([x, z], current.current, rooms);
      if (next === current.current) return;
      current.current = next;
      if (!next) return;
      setEntry({ room: next, id: ++sequence.current });
      window.dispatchEvent(new CustomEvent('office-sound-cue', { detail: 'step' }));
    }
    const observer = new MutationObserver(readPose);
    observer.observe(surface, { attributes: true, attributeFilter: ['data-player-x', 'data-player-z'] });
    readPose();
    return () => observer.disconnect();
  }, [hud, roomsKey]);

  useEffect(() => {
    if (!entry) return;
    const timer = window.setTimeout(() => setEntry(null), ROOM_ENTRY_MS);
    return () => window.clearTimeout(timer);
  }, [entry]);

  return <div className='play-room-entry' role='status' aria-live='polite' aria-atomic='true'>
    {entry && <span key={entry.id}>Entering {OFFICE_ANCHORS[entry.room].name}</span>}
  </div>;
}
