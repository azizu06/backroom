'use client';

import { Component, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { LlmToggle } from '../../components/LlmToggle';
import { isCloseKey, roomLabel, seatLabel } from '../../lib/office/a11y';
import { WalkMotion } from '../../lib/office/motion';
import { createMockOfficeState } from '../../lib/office/preview';
import { INITIAL_OFFICE, OFFICE_ANCHORS, matchingDenial, visibleRooms, type AnchorId, type OfficeAgent, type OfficeSnapshot, type OfficeState } from '../../lib/office/state';
import { OfficeLobby } from './OfficeLobby';
import type { RoomLabels } from './scene';
import '../office.css';
import './a11y.css';

function SceneLoading({ error }: { error?: Error | null }) {
  // next/dynamic passes load errors to this renderer; let SceneBoundary handle them.
  if (error) throw error;
  return <div role='status' style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#202620', color: '#d8d8e0' }}>
    Loading 3D office…
  </div>;
}
const OfficeScene = dynamic(() => import('./scene').then(module => module.OfficeScene), {
  ssr: false,
  loading: SceneLoading,
});

type ViewMode = 'walk' | 'tween' | 'plan';
function PlanAgent({ agent, recorded }: { agent: OfficeAgent; recorded: boolean }) {
  const marker = useRef<HTMLDivElement>(null);
  const motion = useRef(new WalkMotion(agent.pos));
  useEffect(() => {
    motion.current.position[0] = agent.pos[0]; motion.current.position[1] = agent.pos[1];
    motion.current.moveTo(agent.targetAnchor);
  }, [agent.pos[0], agent.pos[1]]);
  useEffect(() => { motion.current.moveTo(agent.targetAnchor); }, [agent.targetAnchor]);
  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    function draw(now: number) {
      if (!recorded) motion.current.advance((now - previous) / 1000); previous = now;
      if (marker.current) {
        marker.current.style.left = `${50 + motion.current.position[0] / 16 * 100}%`;
        marker.current.style.top = `${50 + motion.current.position[1] / 11 * 100}%`;
      }
      frame = requestAnimationFrame(draw);
    }
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [recorded]);
  useEffect(() => { if (recorded) motion.current.position.splice(0, 2, ...agent.pos); }, [recorded, agent.pos]);
  return <div ref={marker} className='plan-agent' role='img' aria-label={seatLabel(agent)} data-escalating={!!agent.escalationId}>
    {agent.escalationId && <span aria-hidden='true'>▱ </span>}{agent.name}
  </div>;
}
function FloorPlan({ snapshot, select }: { snapshot: OfficeSnapshot; select: (room: AnchorId, opener: HTMLButtonElement) => void }) {
  return <div className='floor-plan' aria-label='2D office floor plan'>
    <div className='plan-aisle' aria-hidden='true' />
    {visibleRooms(snapshot).map(room => <button key={room} className='plan-room' aria-label={roomLabel(room, snapshot)} onClick={event => select(room, event.currentTarget)}
      style={{ left: `${50 + OFFICE_ANCHORS[room].center[0] / 16 * 100}%`, top: `${50 + OFFICE_ANCHORS[room].center[1] / 11 * 100}%` }}>
      {OFFICE_ANCHORS[room].name}{room === 'treasury' && ' · Locked'}
      {matchingDenial(snapshot, room) && <span className='denial-text' data-denial-audit={matchingDenial(snapshot, room)!.auditId}>Entry denied</span>}
    </button>)}
    {snapshot.agents.map(agent => <PlanAgent key={agent.id} agent={agent} recorded={snapshot.connection === 'replay'} />)}
  </div>;
}
class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
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
  const [mode, setMode] = useState<ViewMode>('tween');
  const [focus, setFocus] = useState<AnchorId | null>(null);
  const [inspecting, setInspecting] = useState<AnchorId | null>(null);
  const [lostContext, setLostContext] = useState(false);
  const labels: RoomLabels = { lobby: useRef(null), collections: useRef(null), payables: useRef(null), vendor_onboarding: useRef(null), dana: useRef(null), treasury: useRef(null) };
  const onFailure = useCallback(() => setLostContext(true), []);
  useEffect(() => {
    if (!window.matchMedia('(max-width: 760px), (prefers-reduced-motion: reduce)').matches) setMode('walk');
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
        <label htmlFor='office-view'>View <select id='office-view' aria-label='Office view' value={mode} onChange={e => setMode(e.target.value as ViewMode)}>
          <option value='walk'>Orbit camera</option><option value='tween'>Fixed camera</option><option value='plan'>Floor plan</option>
        </select></label>
      </div>
    </header>
    <nav className='room-navigation' aria-label='Room camera presets'>
      <button aria-pressed={focus === null} onClick={() => { setFocus(null); setInspecting(null); }}>Full floor</button>
      {visibleRooms(snapshot).map(room => <button key={room} aria-pressed={focus === room} onClick={() => { setFocus(room); setInspecting(null); }}>{OFFICE_ANCHORS[room].name}{room === 'treasury' ? ' · Locked' : ''}</button>)}
    </nav>
    <div className='office-viewport' data-testid='office-viewport'>
      <p className='visually-hidden'>3D office view. Use the room buttons to inspect badges and limits.</p>
      <SceneBoundary fallback={<FloorPlan snapshot={snapshot} select={inspect} />} onFailure={onFailure}>
        {plan ? <FloorPlan snapshot={snapshot} select={inspect} /> : <>
          <OfficeScene snapshot={snapshot} fixed={mode === 'tween'} focus={focus} labels={labels} onFailure={onFailure} />
          {visibleRooms(snapshot).map(room => {
            const badge = snapshot.badges.find(row => row.seatId === room);
            return <div key={room} ref={labels[room]} className='scene-label'>
              <button className='desk-label' onClick={event => inspect(room, event.currentTarget)} aria-label={roomLabel(room, snapshot)}>
                {OFFICE_ANCHORS[room].name}<span>{badge ? `Badge · v${badge.policyVersion}` : room === 'treasury' ? 'Locked · Dana only' : room === 'lobby' ? 'Audit wall + inbox' : 'Human approval'}</span>
              </button>
            </div>;
          })}
        </>}
      </SceneBoundary>
      {inspecting && <RoomInspector room={inspecting} snapshot={snapshot} close={closeInspector} inboxTray={inboxTray} />}
      <div className='office-caption'>{lostContext ? '3D unavailable · floor plan active' : plan ? 'Floor plan · same subscribed state' : mode === 'tween' ? 'Fixed camera · smooth walks' : 'Drag to look around · choose a room to focus'}</div>
      {snapshot.connection === 'disconnected' && <div className='office-disconnected' role='alert'>Connection lost. Last received state is shown; model control is disabled.</div>}
    </div>
    <footer className='office-footer'>
      <div className='seat-statuses'>{snapshot.agents.map(agent => <div key={agent.id} tabIndex={0} role='group' aria-label={seatLabel(agent)} data-agent-id={agent.id} data-target={agent.targetAnchor} data-escalating={!!agent.escalationId} data-row-at={agent.rowAt}>
        <strong>{agent.name}</strong><span>{agent.state}</span>{agent.escalationId && <span className='folder-status'>▱ Folder → {OFFICE_ANCHORS[agent.targetAnchor].name}</span>}
      </div>)}</div>
      <section id='office-audit-wall' className={auditWall ? 'office-lobby' : 'office-audit'} aria-label='Office audit receipts' data-office-mount='audit-wall'>
        {auditWall ?? <><h2>Lobby audit wall <span>{snapshot.connection === 'preview' ? 'Preview receipts' : snapshot.connection === 'replay' ? 'REPLAY receipts' : 'Subscribed receipts'}</span></h2>
          {!snapshot.audit.length ? <p>No decisions received.</p> : <ol>{snapshot.audit.slice(-20).reverse().map(entry => <li key={entry.id} data-audit-id={entry.id}>
            <strong className={entry.decision === 'DENY' ? 'denial-text' : ''}>{entry.decision}</strong> {entry.summary}<br /><code>{entry.id} · {entry.ruleIds.join(', ')}</code>
          </li>)}</ol>}</>}
      </section>
      {inboxTray && <section id='office-inbox-tray' className='office-audit' aria-label='Lobby inbox tray' data-office-mount='inbox'><h2>Lobby inbox tray · {snapshot.inboxCount}</h2>{inboxTray}</section>}
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
