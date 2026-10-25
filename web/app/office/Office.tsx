'use client';

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { requestSceneFrame } from '../../lib/office/frame';
import { LlmToggle } from '../../components/LlmToggle';
import { SiteNav } from '../../components/SiteNav';
import { PlayInput, type PlayBridge, type PlayTarget } from '../../lib/office/play';
import { PLAY_HINT, PLAY_TOUCH_HINT, PlayHud, useTouch } from './PlayHud';
import { roomLabel, seatLabel } from '../../lib/office/a11y';
import { MotionRegistry } from '../../lib/office/motion';
import { createMockOfficeState } from '../../lib/office/preview';
import { INITIAL_OFFICE, OFFICE_ANCHORS, anchorLabel, visibleRooms, type AnchorId, type OfficeSnapshot, type OfficeState } from '../../lib/office/state';
import { INITIAL_VIEWPORT, VIEW_OPTIONS, isFixedCamera, viewportLayers, viewportReducer, type ViewMode } from '../../lib/office/view';
import { TOUR_INTERRUPT_EVENTS, TOUR_STEP_MS, tourCaption, tourIndexAt, tourStops } from '../../lib/office/tour';
import { OfficeLobby } from './OfficeLobby';
import { OfficeHelp } from './OfficeHelp';
import { StoryMode } from './StoryMode';
import { useStoryMode } from './useStoryMode';
import type { StoryChapter } from '../../lib/office/story';
import { SoundToggle } from './SoundToggle';
import { PresenceChip } from './PresenceChip';
import { usePresence } from './usePresence';
import { useProximityChat } from './useProximityChat';
import { coworkerSpots } from '../../lib/office/targets/coworker';
import type { CoworkerSpot } from '../../lib/office/play';
import { FloorPlan } from './FloorPlan';
import { ReceiptList } from './ReceiptList';
import { RoomInspector } from './RoomInspector';
import { ViewBoundary } from './ViewBoundary';
import { HandoffLog, HandoffPresentation, HandoffTags, useOfficeHandoffs } from './handoffs/HandoffPresentation';
import type { AgentTagLookup, RoomLabels } from './scene';
import '../office.css';
import './a11y.css';
import './lobby.css';
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

/** All finance state comes through OfficeState. Commands belong to an authenticated controller. */
export function Office({ source, controls, onToggleLlm, auditWall, inboxTray, storyStart = false, storyPreview }: {
  source: OfficeState; controls?: ReactNode; onToggleLlm?: (enabled: boolean) => Promise<void>;
  auditWall?: ReactNode | ((snapshot: OfficeSnapshot, focus: (anchor: AnchorId) => void) => ReactNode); inboxTray?: ReactNode; storyStart?: boolean; storyPreview?: (preview: StoryChapter['preview']) => void;
}) {
  const received = useSyncExternalStore(source.subscribe, source.getSnapshot, () => INITIAL_OFFICE);
  const { snapshot, presentation } = useOfficeHandoffs(received);
  const [viewport, dispatch] = useReducer(viewportReducer, INITIAL_VIEWPORT);
  const touch = useTouch();
  const { mode, lostContext, sceneAttempt } = viewport;
  const layers = viewportLayers(viewport);
  const [focus, setFocus] = useState<AnchorId | null>(null);
  const [inspecting, setInspecting] = useState<AnchorId | null>(null);
  const [motions] = useState(() => new MotionRegistry());
  // Play is first person over the same scene; exiting returns to the view chosen before it.
  const [playTarget, setPlayTarget] = useState<PlayTarget | null>(null);
  const [play] = useState((): PlayBridge & { hud: { current: HTMLDivElement | null }; coworkers: { current: readonly CoworkerSpot[] } } => ({ input: new PlayInput(), onTarget: setPlayTarget, hud: { current: null }, coworkers: { current: [] } }));
  const presence = usePresence({ mode, hud: play.hud, source, connectionMode: snapshot.connection });
  play.coworkers.current = coworkerSpots(presence.peers);
  const { setEnabled: setPresence } = presence;
  const showCoworkers = useCallback(() => setPresence(true), [setPresence]);
  const chat = useProximityChat({ active: mode === 'play' && presence.enabled, hud: play.hud, selfId: presence.selfId, presence: presence.enabled, showCoworkers });
  const prePlay = useRef<ViewMode>('walk');
  useEffect(() => { if (mode !== 'play') prePlay.current = mode; }, [mode]);
  function exitPlay() { pickMode(prePlay.current); document.getElementById('office-view')?.focus(); }
  const recorded = snapshot.connection === 'replay';
  // The 3D scene renders on demand: request a frame here, not from effects inside the Canvas root.
  useEffect(() => { if (motions.sync(snapshot.agents, { recorded })) requestSceneFrame(); }, [motions, snapshot.agents, recorded]);
  const labels: RoomLabels = { lobby: useRef(null), collections: useRef(null), payables: useRef(null), vendor_onboarding: useRef(null), dana: useRef(null), treasury: useRef(null) };
  const onFailure = useCallback(() => dispatch({ type: 'lost', attempt: sceneAttempt }), [sceneAttempt]);
  const onRestored = useCallback(() => dispatch({ type: 'restored', attempt: sceneAttempt }), [sceneAttempt]);
  const pickMode = useCallback((next: ViewMode) => dispatch({ type: 'pick', mode: next }), []);
  const tagElements = useRef(new Map<string, HTMLDivElement>());
  const agentTag = useCallback<AgentTagLookup>(id => tagElements.current.get(id), []);
  const touring = mode === 'tour';
  const [tour, setTour] = useState<{ stops: AnchorId[]; index: number } | null>(null);
  const rooms = visibleRooms(snapshot);
  const { storyActive, storyChapter, reducedMotion, chapters, closeStory, changeStoryChapter, startStory, viewportRef } = useStoryMode({
    rooms, storyStart, setFocus, setInspecting, setTour, pickMode,
  });
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
    if (!touring || storyActive) return;
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
  }, [touring, storyActive]);
  // Added after the switch to the tour commits, so the select interaction that started it does not cancel it.
  useEffect(() => {
    if (!touring || storyActive) return;
    for (const type of TOUR_INTERRUPT_EVENTS) window.addEventListener(type, interruptTour, { capture: true, passive: true });
    return () => { for (const type of TOUR_INTERRUPT_EVENTS) window.removeEventListener(type, interruptTour, { capture: true }); };
  }, [touring, interruptTour, storyActive]);
  const tourStop = touring && tour ? tour.stops[tour.index] : undefined;
  useEffect(() => {
    if (!storyStart && !window.matchMedia('(max-width: 760px), (prefers-reduced-motion: reduce)').matches) dispatch({ type: 'prefer', mode: 'walk' });
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
  return <HandoffPresentation value={presentation}><section className='office-shell' aria-label='Backroom office' data-connection={snapshot.connection}>
    {source.getSnapshot().connection !== 'replay' && <h1 className='visually-hidden'>Northfield Studio back office</h1>}
    <SiteNav placement='office' />
    <header className='office-toolbar'>
      <div><strong>Backroom</strong><span className='toolbar-divider'>/</span><span>Northfield Studio</span></div>
      <div className='office-tools'>
        <OfficeHelp />
        <span className='connection-status' role='status'>{snapshot.connection === 'preview' ? 'Preview · simulated state' : snapshot.connection === 'replay' ? 'REPLAY · recorded state' : snapshot.connection === 'live' ? 'State connected' : `State ${snapshot.connection}`}</span>
        <PresenceChip enabled={presence.enabled} setEnabled={presence.setEnabled} peers={presence.peers} selfName={presence.selfName} mode={mode === 'play' ? 'play' : touring ? 'tour' : 'overview'} />
        <fieldset disabled={!onToggleLlm || snapshot.connection !== 'live'} className='llm-control'>
          <LlmToggle llmEnabled={snapshot.llmEnabled} onToggle={onToggleLlm ?? (async () => { throw new Error('Controller transport required'); })} />
        </fieldset>
        <button type='button' onClick={() => { if (storyActive) closeStory(); else startStory(); }}>{storyActive ? 'Skip tour' : 'Take the tour'}</button>
        <label htmlFor='office-view'>View <select disabled={storyActive} ref={viewSelect} id='office-view' aria-label='Office view' value={mode} onChange={e => pickMode(e.target.value as ViewMode)}>
          {VIEW_OPTIONS.map(option => <option key={option.mode} value={option.mode}>{option.label}</option>)}
        </select></label>
      </div>
    </header>
    <nav className='room-navigation' aria-label='Room camera presets'>
      <button aria-pressed={focus === null} onClick={() => { setFocus(null); setInspecting(null); }}>Full floor</button>
      {visibleRooms(snapshot).map(room => <button key={room} aria-pressed={focus === room} onClick={() => { setFocus(room); setInspecting(null); }}>{OFFICE_ANCHORS[room].name}{room === 'treasury' ? ' · Locked' : ''}</button>)}
    </nav>
    <div ref={viewportRef} className='office-viewport' data-testid='office-viewport'>
      <SoundToggle snapshot={snapshot} />
      <p className='visually-hidden'>3D office view. Use the room buttons to inspect badges and limits.</p>
      <ViewBoundary name='3D scene' resetKey={sceneAttempt} fallback={<FloorPlan snapshot={snapshot} motions={motions} select={inspect} />} onFailure={onFailure}>
        {!layers.scene ? <FloorPlan snapshot={snapshot} motions={motions} select={inspect} /> : <>
          {/* Keyed by attempt: picking a view after a lost context builds a fresh Canvas and WebGL context.
              Kept mounted while lost so `webglcontextrestored` can bring this attempt back. */}
          <div key={layers.scene.key} style={{ position: 'absolute', inset: 0, visibility: layers.scene.visible ? undefined : 'hidden' }} aria-hidden={!layers.scene.visible || undefined}>
            <OfficeScene snapshot={snapshot} motions={motions} fixed={isFixedCamera(mode)} tour={touring || storyActive} paused={!layers.scene.visible} focus={focus} labels={labels} agentTag={agentTag} onFailure={onFailure} onRestored={onRestored} play={mode === 'play' ? { ...play, story: storyChapter } : undefined} presence={presence.peers} chatBubbles={chat.bubbles} />
          </div>
          {/* The footer seat statuses already announce every name and state (seatLabel), so the tags are hidden from assistive tech. */}
          {!layers.floorPlan && <div className='agent-tags' aria-hidden='true'>{snapshot.agents.map(agent => <div key={agent.id} className='agent-tag' data-agent-tag={agent.id}
            ref={element => { if (!element) return; tagElements.current.set(agent.id, element); return () => { if (tagElements.current.get(agent.id) === element) tagElements.current.delete(agent.id); }; }}>
            <strong>{agent.name}</strong><span className='agent-tag-state'>{agent.escalationId && '▱ '}{agent.state}</span>
          </div>)}</div>}
          {!layers.floorPlan && <HandoffTags />}
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
      {mode === 'play' && layers.scene?.visible && (storyActive
        ? <div ref={play.hud} data-testid='story-camera' aria-hidden='true' />
        : <PlayHud snapshot={snapshot} input={play.input} target={playTarget} hud={play.hud} onExit={exitPlay} chat={chat} onHelp={() => window.dispatchEvent(new CustomEvent('office-help'))} />)}
      {inspecting && <RoomInspector room={inspecting} snapshot={snapshot} close={closeInspector} inboxTray={inboxTray} />}
      <div className='office-caption'>{lostContext ? '3D unavailable · floor plan active' : plan ? 'Floor plan · same subscribed state' : storyActive ? 'Judge tour · ←/→ chapters · Space pause · Esc exit' : mode === 'play' ? touch ? PLAY_TOUCH_HINT : PLAY_HINT : touring ? tour ? tourCaption(tour.index, tour.stops) : 'Tour' : mode === 'tween' ? 'Fixed camera · smooth walks' : 'Drag to look around · choose a room to focus'}</div>
      <p className='visually-hidden' role='status' aria-live='polite'>{tourStop ? `Tour stop: ${OFFICE_ANCHORS[tourStop].name}` : ''}</p>
      {touring && <button type='button' className='tour-stop' onClick={stopTour}>Stop tour</button>}
      {storyActive && <StoryMode key={chapters.length} chapters={chapters} onChapter={changeStoryChapter} onExit={closeStory} onPreview={storyPreview} reduced={reducedMotion} snapshot={snapshot} />}
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
        {typeof auditWall === 'function' ? auditWall(snapshot, setFocus) : auditWall ?? <ReceiptList snapshot={snapshot} title='Lobby audit wall' />}
        </ViewBoundary>
      </section>
      {auditWall && (snapshot.connection === 'preview' || snapshot.connection === 'replay') && <section id='office-preview-receipts' className='office-audit' aria-label='Preview audit receipts'>
        <ViewBoundary name='Preview receipts' resetKey={snapshot} fallback={<p role='status'>Preview receipts unavailable · a received row could not be displayed.</p>}>
          <ReceiptList snapshot={snapshot} title='Office receipts' />
        </ViewBoundary>
      </section>}
      {inboxTray && <section id='office-inbox-tray' className='office-audit' aria-label='Lobby inbox tray' data-office-mount='inbox'><h2>Lobby inbox tray · {snapshot.inboxCount}</h2>
        <ViewBoundary name='Inbox tray' resetKey={snapshot} fallback={<p role='status'>Inbox unavailable · the tray could not be displayed.</p>}>{inboxTray}</ViewBoundary>
      </section>}
      <ViewBoundary name='Handoff log' resetKey={snapshot.handoffs} fallback={<p role='status'>Handoff log unavailable.</p>}><HandoffLog /></ViewBoundary>
      {controls}
    </footer>
  </section></HandoffPresentation>;
}
/** Explicit preview producer; its controls cannot call reducers, tools or models. */
export function MockOffice({ storyStart = false }: { storyStart?: boolean }) {
  const [mock] = useState(createMockOfficeState);
  const snapshot = useSyncExternalStore(mock.source.subscribe, mock.source.getSnapshot, () => INITIAL_OFFICE);
  const atDana = snapshot.agents[0]?.targetAnchor === 'dana';
  return <Office source={mock.source} storyStart={storyStart} storyPreview={preview => { if (preview === 'denial') mock.denyTreasury(); if (preview === 'escalation') mock.setTargetAnchor('dana'); }} auditWall={(snapshot, focus) => <OfficeLobby snapshot={snapshot} focus={focus} />} controls={<div className='mock-controls'>
    <span>Preview only</span>
    <a href='/inbox'>Judge inbox</a>
    <span>Receipts there are not synced into this static scene.</span>
    <button onClick={() => mock.setTargetAnchor(atDana ? 'collections' : 'dana')}>{atDana ? 'Return to Collections' : 'Preview escalation'}</button>
    <button onClick={() => mock.denyTreasury()}>Preview Treasury denial</button>
  </div>} />;
}
