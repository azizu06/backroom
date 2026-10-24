'use client';

import { Component, useCallback, useEffect, useId, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { requestSceneFrame } from '../../lib/office/frame';
import { LlmToggle } from '../../components/LlmToggle';
import { isCloseKey, roomLabel, seatLabel } from '../../lib/office/a11y';
import { MotionRegistry, type WalkMotion } from '../../lib/office/motion';
import { createMockOfficeState } from '../../lib/office/preview';
import { INITIAL_OFFICE, OFFICE_ANCHORS, anchorLabel, matchingDenial, visibleRooms, type AnchorId, type OfficeAgent, type OfficeSnapshot, type OfficeState } from '../../lib/office/state';
import { INITIAL_VIEWPORT, boundaryStateForProps, isFixedCamera, reportViewFailure, viewportLayers, viewportReducer, type BoundaryState, type ViewMode } from '../../lib/office/view';
import { TOUR_INTERRUPT_EVENTS, TOUR_STEP_MS, tourCaption, tourIndexAt, tourStops } from '../../lib/office/tour';
import { OfficeLobby } from './OfficeLobby';
import type { AgentTagLookup, RoomLabels } from './scene';
import '../office.css';
import './a11y.css';
import './tags.css';

function SceneLoading({ error }: { error?: Error | null }) {
  // next/dynamic passes load errors to this renderer; let the 3D ViewBoundary handle them.
  if (error) throw error;
  return <div role='status' style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#202620', color: '#d8d8e0' }}>
    Loading 3D office…
  </div>;
}
const OfficeScene = dynamic(() => import('./scene').then(module => module.OfficeScene), {
  ssr: false,
  loading: SceneLoading,
});

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
function FloorPlan({ snapshot, motions, select }: { snapshot: OfficeSnapshot; motions: MotionRegistry; select: (room: AnchorId, opener: HTMLButtonElement) => void }) {
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
/** Contains a render failure to its own region; a changed `resetKey` retries the children. */
class ViewBoundary extends Component<{ name: string; children: ReactNode; fallback: ReactNode; onFailure?: () => void; resetKey?: unknown }, BoundaryState> {
  state: BoundaryState = { failed: false, resetKey: this.props.resetKey };
  static getDerivedStateFromError() { return { failed: true }; }
  static getDerivedStateFromProps(props: { resetKey?: unknown }, state: BoundaryState) { return boundaryStateForProps(props.resetKey, state); }
  componentDidCatch(error: unknown) { reportViewFailure(this.props.name, error, this.props.onFailure); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}
function valueText(value: unknown): string {
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
/** Display exact values from subscribed badge rows, never infer permission from the room. */
function RoomInspector({ room, snapshot, close, inboxTray }: {
  room: AnchorId; snapshot: OfficeSnapshot; close: () => void; inboxTray?: ReactNode;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const headingId = useId();
  useEffect(() => { closeButton.current?.focus(); }, [room]);
  const badge = snapshot.badges.find(row => row.seatId === room);
  const denial = matchingDenial(snapshot, room);
  return <section className='room-inspector' role='dialog' aria-labelledby={headingId} onKeyDown={event => {
    if (isCloseKey(event.key)) { event.preventDefault(); close(); }
  }}>
    <header><h2 id={headingId}>{OFFICE_ANCHORS[room].name}</h2><button ref={closeButton} onClick={close} aria-label={`Close ${OFFICE_ANCHORS[room].name} details`}>×</button></header>
    {badge ? <>
      <p>Policy version {badge.policyVersion}</p>
      <dl>{Object.entries(badge.limits).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{valueText(value)}</dd></div>)}</dl>
      <p><strong>Allowed rooms</strong><br />{badge.rooms.join(', ')}</p>
      <details><summary>Allowed actions ({badge.actions.length})</summary><ul>{badge.actions.map(action => <li key={action}>{action}</li>)}</ul></details>
      {!Object.keys(badge.limits).length && <p>No monetary authority in this badge.</p>}
    </> : room === 'treasury' ? <p>Locked · Dana only. Entry and money movement require server authorization.</p>
      : room === 'dana' ? <p>Human review. Approvals require Dana’s passkey on the approval card.</p>
      : <><h3>Audit wall</h3><p><a href='#office-audit-wall'>Open the audit wall below</a></p>
        <div data-office-mount='inbox-inspector'><h3>Inbox tray · {snapshot.inboxCount}</h3>{inboxTray ? <a href='#office-inbox-tray'>Open the lobby tray below</a> : <p>Preview contains three fixture items.</p>}</div></>}
    {denial && <p className='denial-text' role='status'>Entry denied · audit {denial.auditId}</p>}
  </section>;
}
/** All finance state comes through OfficeState. Commands belong to an authenticated controller. */
export function Office({ source, controls, onToggleLlm, auditWall, inboxTray }: {
  source: OfficeState; controls?: ReactNode; onToggleLlm?: (enabled: boolean) => Promise<void>;
  auditWall?: ReactNode; inboxTray?: ReactNode;
}) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, () => INITIAL_OFFICE);
  const [viewport, dispatch] = useReducer(viewportReducer, INITIAL_VIEWPORT);
  const { mode, lostContext, sceneAttempt } = viewport;
  const layers = viewportLayers(viewport);
  const [focus, setFocus] = useState<AnchorId | null>(null);
  const [inspecting, setInspecting] = useState<AnchorId | null>(null);
  const [motions] = useState(() => new MotionRegistry());
  const recorded = snapshot.connection === 'replay';
  // The 3D scene renders on demand: request a frame here, not from effects inside the Canvas root.
  useEffect(() => { if (motions.sync(snapshot.agents, { recorded })) requestSceneFrame(); }, [motions, snapshot.agents, recorded]);
  const labels: RoomLabels = { lobby: useRef(null), collections: useRef(null), payables: useRef(null), vendor_onboarding: useRef(null), dana: useRef(null), treasury: useRef(null) };
  const onFailure = useCallback(() => dispatch({ type: 'lost', attempt: sceneAttempt }), [sceneAttempt]);
  const onRestored = useCallback(() => dispatch({ type: 'restored', attempt: sceneAttempt }), [sceneAttempt]);
  function pickMode(next: ViewMode) { dispatch({ type: 'pick', mode: next }); }
  const tagElements = useRef(new Map<string, HTMLDivElement>());
  const agentTag = useCallback<AgentTagLookup>(id => tagElements.current.get(id), []);
  const touring = mode === 'tour';
  const [tour, setTour] = useState<{ stops: AnchorId[]; index: number } | null>(null);
  const rooms = visibleRooms(snapshot);
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const stopTour = useCallback(() => dispatch({ type: 'endTour' }), []);
  const viewSelect = useRef<HTMLSelectElement>(null);
  // Any input ends the tour, except the view select's own navigation keys: its onChange picks the next view.
  const interruptTour = useCallback((event: Event) => {
    if (event instanceof KeyboardEvent && event.target === viewSelect.current && /^(Arrow|Home$|End$|Page)/.test(event.key)) return;
    stopTour();
  }, [stopTour]);
  // The tour only moves the camera: each stop is a focus change, and finishing returns to the full floor.
  useEffect(() => {
    if (!touring) return;
    const stops = tourStops(roomsRef.current);
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setInspecting(null);
    function step() {
      const index = tourIndexAt(performance.now() - started, stops.length);
      if (index === null) {
        setFocus(null);
        dispatch({ type: 'endTour' });
        return;
      }
      setTour({ stops, index });
      setFocus(stops[index]!);
      timer = setTimeout(step, Math.max(0, started + (index + 1) * TOUR_STEP_MS - performance.now()));
    }
    step();
    return () => { clearTimeout(timer); setTour(null); };
  }, [touring]);
  // Added after the switch to the tour commits, so the select interaction that started it does not cancel it.
  useEffect(() => {
    if (!touring) return;
    for (const type of TOUR_INTERRUPT_EVENTS) window.addEventListener(type, interruptTour, { capture: true, passive: true });
    return () => { for (const type of TOUR_INTERRUPT_EVENTS) window.removeEventListener(type, interruptTour, { capture: true }); };
  }, [touring, interruptTour]);
  const tourStop = touring && tour ? tour.stops[tour.index] : undefined;
  useEffect(() => {
    if (!window.matchMedia('(max-width: 760px), (prefers-reduced-motion: reduce)').matches) dispatch({ type: 'prefer', mode: 'walk' });
  }, []);
  const inspectorOpener = useRef<HTMLElement | null>(null);
  const closeInspector = useCallback(() => {
    setInspecting(null);
    inspectorOpener.current?.focus();
  }, []);
  function inspect(room: AnchorId, opener: HTMLButtonElement) {
    inspectorOpener.current = opener;
    setInspecting(room);
    setFocus(room);
  }
  const plan = mode === 'plan' || lostContext;
  return <section className='office-shell' aria-label='Backroom office' data-connection={snapshot.connection}>
    <header className='office-toolbar'>
      <div><strong>Backroom</strong><span className='toolbar-divider'>/</span><span>Northfield Studio</span></div>
      <div className='office-tools'>
        <span className='connection-status' role='status'>{snapshot.connection === 'preview' ? 'Preview · simulated state' : snapshot.connection === 'replay' ? 'REPLAY · recorded state' : snapshot.connection === 'live' ? 'State connected' : `State ${snapshot.connection}`}</span>
        <fieldset disabled={!onToggleLlm || snapshot.connection !== 'live'} className='llm-control'>
          <LlmToggle llmEnabled={snapshot.llmEnabled} onToggle={onToggleLlm ?? (async () => { throw new Error('Controller transport required'); })} />
        </fieldset>
        <label htmlFor='office-view'>View <select ref={viewSelect} id='office-view' aria-label='Office view' value={mode} onChange={e => pickMode(e.target.value as ViewMode)}>
          <option value='walk'>Orbit camera</option><option value='tween'>Fixed camera</option><option value='plan'>Floor plan</option><option value='tour'>Tour</option>
        </select></label>
      </div>
    </header>
    <nav className='room-navigation' aria-label='Room camera presets'>
      <button aria-pressed={focus === null} onClick={() => { setFocus(null); setInspecting(null); }}>Full floor</button>
      {visibleRooms(snapshot).map(room => <button key={room} aria-pressed={focus === room} onClick={() => { setFocus(room); setInspecting(null); }}>{OFFICE_ANCHORS[room].name}{room === 'treasury' ? ' · Locked' : ''}</button>)}
    </nav>
    <div className='office-viewport' data-testid='office-viewport'>
      <p className='visually-hidden'>3D office view. Use the room buttons to inspect badges and limits.</p>
      <ViewBoundary name='3D scene' resetKey={sceneAttempt} fallback={<FloorPlan snapshot={snapshot} motions={motions} select={inspect} />} onFailure={onFailure}>
        {!layers.scene ? <FloorPlan snapshot={snapshot} motions={motions} select={inspect} /> : <>
          {/* Keyed by attempt: picking a view after a lost context builds a fresh Canvas and WebGL context.
              Kept mounted while lost so `webglcontextrestored` can bring this attempt back. */}
          <div key={layers.scene.key} style={{ position: 'absolute', inset: 0, visibility: layers.scene.visible ? undefined : 'hidden' }} aria-hidden={!layers.scene.visible || undefined}>
            <OfficeScene snapshot={snapshot} motions={motions} fixed={isFixedCamera(mode)} tour={touring} paused={!layers.scene.visible} focus={focus} labels={labels} agentTag={agentTag} onFailure={onFailure} onRestored={onRestored} />
          </div>
          {/* The footer seat statuses already announce every name and state (seatLabel), so the tags are hidden from assistive tech. */}
          {!layers.floorPlan && <div className='agent-tags' aria-hidden='true'>{snapshot.agents.map(agent => <div key={agent.id} className='agent-tag' data-agent-tag={agent.id}
            ref={element => { if (!element) return; tagElements.current.set(agent.id, element); return () => { if (tagElements.current.get(agent.id) === element) tagElements.current.delete(agent.id); }; }}>
            <strong>{agent.name}</strong><span className='agent-tag-state'>{agent.escalationId && '▱ '}{agent.state}</span>
          </div>)}</div>}
          {layers.floorPlan ? <FloorPlan snapshot={snapshot} motions={motions} select={inspect} /> : visibleRooms(snapshot).map(room => {
            const badge = snapshot.badges.find(row => row.seatId === room);
            return <div key={room} ref={labels[room]} className='scene-label'>
              <button className='desk-label' onClick={event => inspect(room, event.currentTarget)} aria-label={roomLabel(room, snapshot)}>
                {OFFICE_ANCHORS[room].name}<span>{badge ? `Badge · v${badge.policyVersion}` : room === 'treasury' ? 'Locked · Dana only' : room === 'lobby' ? 'Audit wall + inbox' : 'Human approval'}</span>
              </button>
            </div>;
          })}
        </>}
      </ViewBoundary>
      {inspecting && <RoomInspector room={inspecting} snapshot={snapshot} close={closeInspector} inboxTray={inboxTray} />}
      <div className='office-caption'>{lostContext ? '3D unavailable · floor plan active' : plan ? 'Floor plan · same subscribed state' : touring ? tour ? tourCaption(tour.index, tour.stops) : 'Tour' : mode === 'tween' ? 'Fixed camera · smooth walks' : 'Drag to look around · choose a room to focus'}</div>
      <p className='visually-hidden' role='status' aria-live='polite'>{tourStop ? `Tour stop: ${OFFICE_ANCHORS[tourStop].name}` : ''}</p>
      {touring && <button type='button' className='tour-stop' onClick={stopTour}>Stop tour</button>}
      {snapshot.connection === 'disconnected' && <div className='office-disconnected' role='alert'>Connection lost. Last received state is shown; model control is disabled.</div>}
    </div>
    <footer className='office-footer'>
      <ViewBoundary name='Seat statuses' resetKey={snapshot} fallback={<p role='status'>Seat status unavailable · a received row could not be displayed.</p>}>
      <div className='seat-statuses'>{snapshot.agents.map(agent => <div key={agent.id} tabIndex={0} role='group' aria-label={seatLabel(agent)} data-agent-id={agent.id} data-target={agent.targetAnchor} data-escalating={!!agent.escalationId} data-row-at={agent.rowAt}>
        <strong>{agent.name}</strong><span>{agent.state}</span>{agent.escalationId && <span className='folder-status'>▱ Folder → {anchorLabel(agent.targetAnchor)}</span>}
      </div>)}</div>
      </ViewBoundary>
      <section id='office-audit-wall' className={auditWall ? 'office-lobby' : 'office-audit'} aria-label='Office audit receipts' data-office-mount='audit-wall'>
        <ViewBoundary name='Audit wall' resetKey={snapshot} fallback={<p role='status'>Audit wall unavailable · open the full audit page for receipts.</p>}>
        {auditWall ?? <><h2>Lobby audit wall <span>{snapshot.connection === 'preview' ? 'Preview receipts' : snapshot.connection === 'replay' ? 'REPLAY receipts' : 'Subscribed receipts'}</span></h2>
          {!snapshot.audit.length ? <p>No decisions received.</p> : <ol>{snapshot.audit.slice(-20).reverse().map(entry => <li key={entry.id} data-audit-id={entry.id}>
            <strong className={entry.decision === 'DENY' ? 'denial-text' : ''}>{entry.decision}</strong> {entry.summary}<br /><code>{entry.id} · {entry.ruleIds.join(', ')}</code>
          </li>)}</ol>}</>}
        </ViewBoundary>
      </section>
      {inboxTray && <section id='office-inbox-tray' className='office-audit' aria-label='Lobby inbox tray' data-office-mount='inbox'><h2>Lobby inbox tray · {snapshot.inboxCount}</h2>
        <ViewBoundary name='Inbox tray' resetKey={snapshot} fallback={<p role='status'>Inbox unavailable · the tray could not be displayed.</p>}>{inboxTray}</ViewBoundary>
      </section>}
      {controls}
    </footer>
  </section>;
}
/** Explicit preview producer; its controls cannot call reducers, tools or models. */
export function MockOffice() {
  const [mock] = useState(createMockOfficeState);
  const snapshot = useSyncExternalStore(mock.source.subscribe, mock.source.getSnapshot, () => INITIAL_OFFICE);
  const atDana = snapshot.agents[0]?.targetAnchor === 'dana';
  return <Office source={mock.source} auditWall={<OfficeLobby />} controls={<div className='mock-controls'>
    <span>Preview only</span>
    <button onClick={() => mock.setTargetAnchor(atDana ? 'collections' : 'dana')}>{atDana ? 'Return to Collections' : 'Preview escalation'}</button>
    <button onClick={() => mock.denyTreasury()}>Preview Treasury denial</button>
  </div>} />;
}
