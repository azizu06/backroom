'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { isCloseKey } from '../../../../lib/office/a11y';
import type { MotionRegistry } from '../../../../lib/office/motion';
import { roomRect, seatedAgent, type OverviewPick } from '../../../../lib/office/overview';
import { WORKSTATIONS, CORRIDOR_Z } from '../../../../lib/office/layout';
import { workstationLabel } from '../../../../lib/office/handoffs';
import { DESK_SIZE } from '../../../../lib/office/metrics';
import { FLOOR, SERVER_ROOM_BOX } from '../../../../lib/office/play';
import { OFFICE_ANCHORS, anchorLabel, visibleRooms, type AnchorId, type OfficeSnapshot } from '../../../../lib/office/state';

const SPAN_X = FLOOR.maxX - FLOOR.minX, SPAN_Z = FLOOR.maxZ - FLOOR.minZ;
/** The board keeps the floor's proportions. */
const BOARD_STYLE = { aspectRatio: `${SPAN_X} / ${SPAN_Z}`, width: `min(100%, calc((100dvh - 230px) * ${(SPAN_X / SPAN_Z).toFixed(3)}))` };
/** World floor (x, z) to a percentage of the map board; z runs down the board like the overhead view. */
function pct([x, z]: readonly [number, number]) {
  return { left: `${((x - FLOOR.minX) / SPAN_X) * 100}%`, top: `${((z - FLOOR.minZ) / SPAN_Z) * 100}%` };
}
function rectStyle(rect: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  return { ...pct([rect.minX, rect.minZ]), width: `${((rect.maxX - rect.minX) / SPAN_X) * 100}%`, height: `${((rect.maxZ - rect.minZ) / SPAN_Z) * 100}%` };
}
function roomStatus(snapshot: OfficeSnapshot, room: AnchorId): string {
  if (room === 'treasury') return 'Locked · Dana only';
  if (room === 'lobby') return `Audit wall · inbox ${snapshot.inboxCount}`;
  const id = seatedAgent(snapshot, room);
  const agent = id ? snapshot.agents.find(row => row.id === id) : undefined;
  if (agent) return `${agent.name} · ${agent.state}`;
  return room === 'dana' ? 'Human approval' : 'Empty desk';
}

/**
 * HUD variant (c) Overview: a large 2D map of the whole floor over the scene. Every room is a tile and agents move
 * on it live (read from the shared motions); a room or agent opens the quick menu ("Go here" / "Talk").
 * Never shown in first person. View-only: picks move the camera or open read-only panels.
 */
export function OverviewMap({ snapshot, motions, open, onPick, onFirstPerson, onClose }: {
  snapshot: OfficeSnapshot; motions: MotionRegistry; open: boolean;
  onPick: (pick: OverviewPick, opener: HTMLElement) => void; onFirstPerson: () => void; onClose: () => void;
}) {
  const headingId = useId();
  const root = useRef<HTMLElement>(null);
  const [, setTick] = useState(0);
  // Agents walk between desks: re-read their drawn positions a few times a second while the map is open.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setTick(tick => tick + 1), 250);
    return () => clearInterval(timer);
  }, [open]);
  useEffect(() => { if (open) root.current?.querySelector<HTMLButtonElement>('.overview-map-room')?.focus(); }, [open]);
  if (!open) return null;
  const rooms = visibleRooms(snapshot);
  return <section ref={root} className='overview-map' role='region' aria-labelledby={headingId} onKeyDown={event => {
    if (isCloseKey(event.key) && !event.defaultPrevented && !(event.target as HTMLElement).closest('[role=menu]')) { event.preventDefault(); onClose(); }
  }}>
    <header className='overview-map-head'>
      <div><h2 id={headingId}>Office overview</h2><p>Click a room or a person: go there in first person, or talk.</p></div>
      <div className='overview-map-actions'>
        <button type='button' className='overview-map-fp' aria-keyshortcuts='O' onClick={onFirstPerson}>First person <kbd>O</kbd></button>
        <button type='button' onClick={onClose} aria-label='Close overview'>Close <kbd>Esc</kbd></button>
      </div>
    </header>
    <div className='overview-map-board' style={{ aspectRatio: `${SPAN_X} / ${SPAN_Z}`, width: `min(100%, calc((100dvh - 230px) * ${SPAN_X / SPAN_Z}))` }}>
      <div className='overview-map-hall' style={rectStyle({ minX: FLOOR.minX, maxX: FLOOR.maxX, minZ: CORRIDOR_Z - 0.65, maxZ: CORRIDOR_Z + 0.65 })} aria-hidden='true'><span>Shared office</span></div>
      {WORKSTATIONS.map(({ id, center: [x, z] }, index) => <div key={id} className='overview-map-desk' aria-label={workstationLabel(index)} title={workstationLabel(index)} style={rectStyle({ minX: x - DESK_SIZE.width / 2, maxX: x + DESK_SIZE.width / 2, minZ: z - DESK_SIZE.depth / 2, maxZ: z + DESK_SIZE.depth / 2 })} />)}
      {rooms.map(room => <button key={room} type='button' className='overview-map-room' data-room={room} data-locked={room === 'treasury' || undefined}
        style={{ ...rectStyle(roomRect(room)), ['--room-color' as string]: OFFICE_ANCHORS[room].color }} aria-haspopup='menu'
        onClick={event => onPick({ kind: 'room', room }, event.currentTarget)}>
        <strong>{OFFICE_ANCHORS[room].name}</strong><span>{roomStatus(snapshot, room)}</span>
      </button>)}
      <div className='overview-map-server' style={rectStyle(SERVER_ROOM_BOX)} aria-hidden='true'>GX10</div>
      {snapshot.agents.map(agent => {
        const position = motions.get(agent).position;
        return <button key={agent.id} type='button' className='overview-map-agent' data-agent={agent.id} data-escalating={agent.escalationId ? true : undefined}
          style={pct(position)} aria-haspopup='menu' aria-label={`${agent.name}, ${agent.state}${agent.escalationId ? `, carrying a folder to ${anchorLabel(agent.targetAnchor)}` : ''}. Go here or talk`}
          onClick={event => onPick({ kind: 'agent', id: agent.id }, event.currentTarget)}>
          <span className='overview-map-dot' aria-hidden='true'>{agent.name.slice(0, 1)}</span><span className='overview-map-name'>{agent.name}</span>
        </button>;
      })}
    </div>
  </section>;
}
