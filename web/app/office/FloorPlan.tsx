'use client';

import { useEffect, useRef } from 'react';
import { roomLabel, seatLabel } from '../../lib/office/a11y';
import type { MotionRegistry, WalkMotion } from '../../lib/office/motion';
import { OFFICE_ANCHORS, matchingDenial, visibleRooms, type AnchorId, type OfficeAgent, type OfficeSnapshot } from '../../lib/office/state';

function planLeft(position: readonly number[]) { return `${50 + position[0]! / 16 * 100}%`; }
function planTop(position: readonly number[]) { return `${50 + position[1]! / 11 * 100}%`; }
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
  return <div className='floor-plan' aria-label='2D office floor plan'>
    <div className='plan-aisle' aria-hidden='true' />
    {visibleRooms(snapshot).map(room => <button key={room} className='plan-room' aria-label={roomLabel(room, snapshot)} onClick={event => select(room, event.currentTarget)}
      style={{ left: `${50 + OFFICE_ANCHORS[room].center[0] / 16 * 100}%`, top: `${50 + OFFICE_ANCHORS[room].center[1] / 11 * 100}%` }}>
      {OFFICE_ANCHORS[room].name}{room === 'treasury' && ' · Locked'}
      {matchingDenial(snapshot, room) && <span className='denial-text' data-denial-audit={matchingDenial(snapshot, room)!.auditId}>Entry denied</span>}
    </button>)}
    {snapshot.agents.map(agent => <PlanAgent key={agent.id} agent={agent} motion={motions.get(agent)} recorded={snapshot.connection === 'replay'} />)}
  </div>;
}
