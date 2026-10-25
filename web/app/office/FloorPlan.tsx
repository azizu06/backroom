'use client';

import { useEffect, useRef } from 'react';
import { roomLabel, seatLabel } from '../../lib/office/a11y';
import type { MotionRegistry, WalkMotion } from '../../lib/office/motion';
import { BUILDING, WORKSTATIONS, CORRIDOR_Z } from '../../lib/office/layout';
import { workstationLabel } from '../../lib/office/handoffs';
import { DESK_SIZE } from '../../lib/office/metrics';
import { OFFICE_ANCHORS, matchingDenial, visibleRooms, type AnchorId, type OfficeAgent, type OfficeSnapshot } from '../../lib/office/state';

function planLeft(position: readonly number[]) { return `${(position[0]! - BUILDING.minX) / (BUILDING.maxX - BUILDING.minX) * 100}%`; }
function planTop(position: readonly number[]) { return `${(position[1]! - BUILDING.minZ) / (BUILDING.maxZ - BUILDING.minZ) * 100}%`; }
/** Draws the shared motion; Office's MotionRegistry owns re-seating and retargeting. */
function PlanAgent({ agent, motion, recorded }: { agent: OfficeAgent; motion: WalkMotion; recorded: boolean }) {
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
  return <div ref={marker} className='plan-agent' role='img' aria-label={seatLabel(agent)} data-escalating={!!agent.escalationId}
    style={{ left: planLeft(motion.position), top: planTop(motion.position) }}>
    {agent.escalationId && <span aria-hidden='true'>▱ </span>}{agent.name}
  </div>;
}
export function FloorPlan({ snapshot, motions, select }: { snapshot: OfficeSnapshot; motions: MotionRegistry; select: (room: AnchorId, opener: HTMLButtonElement) => void }) {
  return <div className='floor-plan' aria-label='2D office floor plan' style={{ aspectRatio: `${BUILDING.maxX - BUILDING.minX} / ${BUILDING.maxZ - BUILDING.minZ}`, width: 'min(92%, 68dvh)', height: 'auto' }}>
    <div className='plan-aisle' aria-hidden='true' style={{ top: planTop([0, CORRIDOR_Z - 0.65]), height: `${1.3 / (BUILDING.maxZ - BUILDING.minZ) * 100}%` }} />
    {WORKSTATIONS.map(({ id, center }, index) => <div key={id} className='plan-desk' aria-label={workstationLabel(index)} title={workstationLabel(index)} style={{
      left: planLeft(center), top: planTop(center), width: `${DESK_SIZE.width / (BUILDING.maxX - BUILDING.minX) * 100}%`, height: `${DESK_SIZE.depth / (BUILDING.maxZ - BUILDING.minZ) * 100}%`,
    }} />)}
    {visibleRooms(snapshot).map(room => <button key={room} className='plan-room' aria-label={roomLabel(room, snapshot)} onClick={event => select(room, event.currentTarget)}
      style={{ left: `${(OFFICE_ANCHORS[room].center[0] - BUILDING.minX) / (BUILDING.maxX - BUILDING.minX) * 100}%`, top: `${(OFFICE_ANCHORS[room].center[1] - BUILDING.minZ) / (BUILDING.maxZ - BUILDING.minZ) * 100}%` }}>
      {OFFICE_ANCHORS[room].name}{room === 'treasury' && ' · Locked'}
      {matchingDenial(snapshot, room) && <span className='denial-text' data-denial-audit={matchingDenial(snapshot, room)!.auditId}>Entry denied</span>}
    </button>)}
    {snapshot.agents.map(agent => <PlanAgent key={agent.id} agent={agent} motion={motions.get(agent)} recorded={snapshot.connection === 'replay'} />)}
  </div>;
}
