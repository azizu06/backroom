'use client';

import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { roomLabel, seatLabel } from '../../lib/office/a11y';
import type { MotionRegistry, WalkMotion } from '../../lib/office/motion';
import { BUILDING, WORKSTATIONS, CORRIDOR_Z, POD_BOUNDS, FLOOR_FIXTURES, fixtureBounds, DOORWAYS, LOBBY_BOARD_MOUNT, type Rect } from '../../lib/office/layout';
import { workstationLabel } from '../../lib/office/handoffs';
import { DESK_SIZE } from '../../lib/office/metrics';
import { TICKET_BOARD_BOX } from '../../lib/office/props/ticketBoard';
import { PALETTE, ROLES } from '../../lib/office/palette';
import { DESKS } from '../../lib/office/targets/desk';
import { placePlanLabel, type PlanRect } from '../../lib/office/plan-labels';
import './floor-plan.css';
import type { OverviewPick } from '../../lib/office/overview';
import { OFFICE_ANCHORS, isAnchorId, matchingDenial, visibleRooms, type AnchorId, type OfficeAgent, type OfficeSnapshot } from '../../lib/office/state';

function planLeft(position: readonly number[]) { return `${(position[0]! - BUILDING.minX) / (BUILDING.maxX - BUILDING.minX) * 100}%`; }
function planTop(position: readonly number[]) { return `${(position[1]! - BUILDING.minZ) / (BUILDING.maxZ - BUILDING.minZ) * 100}%`; }
/** Draws the shared motion; Office's MotionRegistry owns re-seating and retargeting. */
function PlanAgent({ agent, motion, recorded, onPick }: { agent: OfficeAgent; motion: WalkMotion; recorded: boolean; onPick?: (pick: OverviewPick, opener: HTMLElement) => void }) {
  const marker = useRef<HTMLDivElement>(null);
  const pos = useRef(agent.pos);
  pos.current = agent.pos;
  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    function draw(now: number) {
      if (recorded) motion.seat(pos.current);
      else motion.advance((now - previous) / 1000);
      previous = now;
      if (marker.current) {
        marker.current.style.left = planLeft(motion.position);
        marker.current.style.top = planTop(motion.position);
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [motion, recorded]);
  const human = agent.id === 'human' || agent.id === 'dana' || agent.name === 'Dana';
  const statusColor = agent.escalationId || /wait|escalat|approval/i.test(agent.state) ? ROLES.statusWarn
    : /deni|error|fail|block/i.test(agent.state) ? ROLES.deny : ROLES.statusOk;
  return <div ref={marker} className='plan-agent' role={onPick ? 'button' : 'img'} tabIndex={onPick ? 0 : undefined}
    data-agent={agent.id} data-human={human || undefined} title={seatLabel(agent)}
    aria-haspopup={onPick ? 'menu' : undefined} aria-label={`${seatLabel(agent)}${human ? ', Human' : ''}`} data-escalating={!!agent.escalationId}
    onClick={event => onPick?.({ kind: 'agent', id: agent.id }, event.currentTarget)}
    onKeyDown={event => {
      if (onPick && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onPick({ kind: 'agent', id: agent.id }, event.currentTarget);
      }
    }}
    style={{ left: planLeft(motion.position), top: planTop(motion.position), pointerEvents: onPick ? 'auto' : undefined,
      '--plan-agent-color': isAnchorId(agent.seatId) ? OFFICE_ANCHORS[agent.seatId].color : PALETTE.slate,
      '--plan-status-color': statusColor } as CSSProperties}>
    <i className='plan-agent-dot' aria-hidden='true' /><span className='plan-agent-name'>{agent.name}</span>
    <span className='plan-agent-status'>{human ? 'Human' : agent.state}</span>
  </div>;
}
const SPAN_X = BUILDING.maxX - BUILDING.minX, SPAN_Z = BUILDING.maxZ - BUILDING.minZ;
function rectStyle(rect: Rect): CSSProperties {
  return { left: planLeft([rect.minX, rect.minZ]), top: planTop([rect.minX, rect.minZ]),
    width: `${(rect.maxX - rect.minX) / SPAN_X * 100}%`, height: `${(rect.maxZ - rect.minZ) / SPAN_Z * 100}%` };
}
const DESK_RECTS = WORKSTATIONS.map(({ center: [x, z] }) => fixtureBounds({ x, z, ...DESK_SIZE }));
const FIXTURES = [
  { id: 'tickets', name: 'Tickets', rect: TICKET_BOARD_BOX },
  { id: 'notice', name: 'Notice board', rect: fixtureBounds(LOBBY_BOARD_MOUNT) },
  { id: 'vault', name: 'Vault', rect: fixtureBounds(FLOOR_FIXTURES.vault) },
  { id: 'server', name: 'Server rack', rect: fixtureBounds(FLOOR_FIXTURES.server) },
  ...DOORWAYS.filter(door => door.kind === 'entrance').map(door => ({ id: door.id, name: 'Entrance',
    rect: fixtureBounds({ x: door.at[0], z: door.at[1] - 0.08, width: door.width, depth: 0.16 }) })),
];
function roomBounds(room: AnchorId): Rect {
  const center = OFFICE_ANCHORS[room].center;
  const station = (DESKS as readonly string[]).includes(room)
    ? WORKSTATIONS.find(desk => desk.center === center) : undefined;
  return station ? POD_BOUNDS[station.pod]! : fixtureBounds({ x: center[0], z: center[1], width: 1, depth: 1 });
}

export function FloorPlan({ snapshot, motions, select, onPick }: { snapshot: OfficeSnapshot; motions: MotionRegistry; select: (room: AnchorId, opener: HTMLButtonElement) => void; onPick?: (pick: OverviewPick, opener: HTMLElement) => void }) {
  const board = useRef<HTMLDivElement>(null);
  const rooms = visibleRooms(snapshot).filter(isAnchorId);
  const labelKey = rooms.map(room => `${room}:${matchingDenial(snapshot, room)?.auditId ?? ''}`).join('|');
  useLayoutEffect(() => {
    const root = board.current;
    if (!root) return;
    const layout = () => {
      const width = root.clientWidth, height = root.clientHeight;
      if (!width || !height) return;
      const pixels = (r: Rect): PlanRect => ({ x: (r.minX - BUILDING.minX) / SPAN_X * width,
        y: (r.minZ - BUILDING.minZ) / SPAN_Z * height, width: (r.maxX - r.minX) / SPAN_X * width,
        height: (r.maxZ - r.minZ) / SPAN_Z * height });
      const occupied = [...DESK_RECTS, ...FIXTURES.map(item => item.rect)].map(pixels);
      for (const label of root.querySelectorAll<HTMLElement>('[data-plan-label]')) {
        const room = label.dataset.room;
        const anchor = room && isAnchorId(room) ? roomBounds(room) : FIXTURES.find(item => item.id === label.dataset.planLabel)!.rect;
        const position = placePlanLabel(pixels(anchor), { width: label.offsetWidth, height: label.offsetHeight },
          { x: 0, y: 0, width, height }, occupied);
        label.style.visibility = position ? 'visible' : 'hidden';
        if (position) {
          label.style.left = `${position.x}px`;
          label.style.top = `${position.y}px`;
          occupied.push(position);
        }
      }
    };
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(root);
    root.querySelectorAll('[data-plan-label]').forEach(label => observer.observe(label));
    return () => observer.disconnect();
  }, [labelKey]);
  return <div ref={board} className='floor-plan' aria-label='2D office floor plan'
    style={{ aspectRatio: `${SPAN_X} / ${SPAN_Z}`, '--plan-room-pad': ROLES.roomPad, '--plan-aisle': ROLES.aisle } as CSSProperties}>
    {POD_BOUNDS.map((rect, index) => <div key={index} className='plan-pod' aria-hidden='true' style={rectStyle(rect)} />)}
    <div className='plan-aisle' aria-hidden='true' style={rectStyle({ ...BUILDING, minZ: CORRIDOR_Z - 0.65, maxZ: CORRIDOR_Z + 0.65 })} />
    {WORKSTATIONS.map(({ id, flip }, index) => <div key={id} className='plan-desk' data-seat-side={flip === 1 ? 'south' : 'north'}
      aria-label={workstationLabel(index)} title={workstationLabel(index)} style={rectStyle(DESK_RECTS[index]!)} />)}
    {FIXTURES.map(item => <div key={item.id} className='plan-fixture' data-fixture={item.id} aria-label={item.name} style={rectStyle(item.rect)} />)}
    {rooms.map(room => <button key={room} type='button' className='plan-room' data-room={room} data-plan-label={room}
      aria-label={roomLabel(room, snapshot)} aria-haspopup={onPick ? 'menu' : undefined}
      onClick={event => onPick ? onPick({ kind: 'room', room }, event.currentTarget) : select(room, event.currentTarget)}>
      {OFFICE_ANCHORS[room].name}
      {matchingDenial(snapshot, room) && <span className='denial-text' data-denial-audit={matchingDenial(snapshot, room)!.auditId}>Entry denied</span>}
    </button>)}
    {FIXTURES.map(item => <span key={item.id} className='plan-fixture-label' data-plan-label={item.id}>{item.name}</span>)}
    {snapshot.agents.map(agent => <PlanAgent key={agent.id} agent={agent} motion={motions.get(agent)} recorded={snapshot.connection === 'replay'} onPick={onPick} />)}
  </div>;
}
