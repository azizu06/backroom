'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { isCloseKey } from '../../../../lib/office/a11y';
import type { MotionRegistry } from '../../../../lib/office/motion';
import { seatedAgent, type OverviewPick } from '../../../../lib/office/overview';
import { WORKSTATIONS, CORRIDOR_Z } from '../../../../lib/office/layout';
import { workstationLabel } from '../../../../lib/office/handoffs';
import { overviewMapAgents, overviewMapLayout } from '../../../../lib/office/overview-map';
import { FLOOR } from '../../../../lib/office/play';
import { OFFICE_ANCHORS, visibleRooms, type AnchorId, type OfficeSnapshot } from '../../../../lib/office/state';

const SPAN_X = FLOOR.maxX - FLOOR.minX, SPAN_Z = FLOOR.maxZ - FLOOR.minZ;
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
 * HUD variant (c) Overview: a large 2D map of the whole floor over the scene.
 * Room cards open the quick menu ("Go here" / "Talk"); live seat occupancy tints the desks.
 * Opened from Play. View-only: picks move the camera or open read-only panels.
 */
export function OverviewMap({ snapshot, motions, open, onPick, onFirstPerson, onClose }: {
  snapshot: OfficeSnapshot; motions: MotionRegistry; open: boolean;
  onPick: (pick: OverviewPick, opener: HTMLElement) => void; onFirstPerson: () => void; onClose: () => void;
}) {
  const headingId = useId();
  const root = useRef<HTMLElement>(null);
  const [, setTick] = useState(0);
  const space = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<AnchorId | null>(null);
  const statusId = useId();
  useEffect(() => {
    if (!open || !space.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.max(0, Math.min(entry.contentRect.width - 4, (entry.contentRect.height - 4) * SPAN_X / SPAN_Z));
      setSize({ width, height: width * SPAN_Z / SPAN_X });
    });
    observer.observe(space.current);
    return () => observer.disconnect();
  }, [open]);
  // Agents walk between desks: refresh seat occupancy while the map is open.
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setTick(tick => tick + 1), 250);
    return () => clearInterval(timer);
  }, [open]);
  useEffect(() => { if (open) root.current?.querySelector<HTMLButtonElement>('.overview-map-room')?.focus(); }, [open, size.width > 0]);
  if (!open) return null;
  const rooms = visibleRooms(snapshot);
  const agents = overviewMapAgents(snapshot, motions);
  const layout = overviewMapLayout(size.width, size.height, rooms);
  return <section ref={root} className='overview-map' role='region' aria-labelledby={headingId} onKeyDown={event => {
    if (isCloseKey(event.key) && !event.defaultPrevented && !(event.target as HTMLElement).closest('[role=menu]')) { event.preventDefault(); onClose(); }
  }}>
    <header className='overview-map-head'>
      <div><h2 id={headingId}>Office Overview</h2><p>Click a room: go there in first person, or talk to its agent.</p></div>
      <div className='overview-map-actions'>
        <button type='button' className='overview-map-fp' aria-keyshortcuts='O' onClick={onFirstPerson}>First Person <kbd>O</kbd></button>
        <button type='button' onClick={onClose} aria-label='Close overview'>Close <kbd>Esc</kbd></button>
      </div>
    </header>
    <div className='overview-map-space' ref={space}>
    {size.width > 0 && <div className='overview-map-board' data-compact={layout.compact} style={size}>
      <div className='overview-map-hall' style={rectStyle({ minX: FLOOR.minX, maxX: FLOOR.maxX, minZ: CORRIDOR_Z - 0.65, maxZ: CORRIDOR_Z + 0.65 })} aria-hidden='true'><span>Shared office</span></div>
      {WORKSTATIONS.map(({ id, pod, flip }, index) => {
        const occupant = agents.find(agent => agent.seat === index);
        const desk = layout.desks[index]!;
        return <div key={id} className='overview-map-desk' data-pod={pod} data-seat-side={flip < 0 ? 'top' : 'bottom'} data-occupant={occupant?.id}
          aria-label={workstationLabel(index)} title={occupant?.name ?? workstationLabel(index)}
          style={{ left: desk.x, top: desk.y, width: desk.width, height: desk.height, ['--seat-color' as string]: occupant?.color }} />;
      })}
      <svg className='overview-map-leaders' width={size.width} height={size.height} aria-hidden='true'>
        {layout.labels.map(label => <line key={label.id} x1={label.anchor.x} y1={label.anchor.y}
          x2={Math.max(label.x, Math.min(label.x + label.width, label.anchor.x))}
          y2={Math.max(label.y, Math.min(label.y + label.height, label.anchor.y))} />)}
      </svg>
      {layout.labels.map(label => {
        const room = label.id as AnchorId;
        return <button key={room} type='button' className='overview-map-room' data-room={room} data-locked={room === 'treasury' || undefined}
          style={{ left: label.x, top: label.y, width: label.width, height: label.height, ['--room-color' as string]: OFFICE_ANCHORS[room].color }} aria-haspopup='menu'
          aria-describedby={layout.compact && selected === room ? statusId : undefined}
          onClick={event => {
            setSelected(room);
            const agent = seatedAgent(snapshot, room);
            onPick(agent ? { kind: 'agent', id: agent } : { kind: 'room', room }, event.currentTarget);
          }}>
          <strong>{OFFICE_ANCHORS[room].name}</strong>{!layout.compact && <span>{roomStatus(snapshot, room)}</span>}
        </button>;
      })}
      <div className='overview-map-server' style={{ left: layout.server.x, top: layout.server.y, width: layout.server.width, height: layout.server.height }} aria-hidden='true'>GX10</div>

    </div>}
    </div>
    <p className='overview-map-status' id={statusId} aria-live='polite'>
      {layout.compact && selected ? `${OFFICE_ANCHORS[selected].name}: ${roomStatus(snapshot, selected)}` : 'Select a room for actions.'}
    </p>
  </section>;
}
