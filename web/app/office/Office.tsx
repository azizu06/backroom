'use client';

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { requestSceneFrame } from '../../lib/office/frame';
import { LlmToggle } from '../../components/LlmToggle';
import { PlayInput, type PlayBridge, type PlayGuide, type PlayTarget } from '../../lib/office/play';
import { PLAY_HINT, PLAY_TOUCH_HINT, PlayHud, useTouch } from './PlayHud';
import { roomLabel, seatLabel } from '../../lib/office/a11y';
import { MotionRegistry } from '../../lib/office/motion';
import { createMockOfficeState } from '../../lib/office/preview';
import { INITIAL_OFFICE, OFFICE_ANCHORS, anchorLabel, visibleRooms, type AnchorId, type OfficeSnapshot, type OfficeState } from '../../lib/office/state';
import { INITIAL_VIEWPORT, viewportLayers, viewportReducer } from '../../lib/office/view';
import { TOUR_INTERRUPT_EVENTS, TOUR_STEP_MS, tourCaption, tourIndexAt, tourStops } from '../../lib/office/tour';
import { OfficeLobby } from './OfficeLobby';
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
import { PlaySplash } from './PlaySplash';
import { COMPACT_QUERY, readStartView, saveStartView, startView } from '../../lib/office/start-mode';
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

/** All finance state comes through OfficeState. Commands belong to an authenticated controller. */
export function Office({ source, controls, onToggleLlm, auditWall, inboxTray, storyStart = false, storyPreview }: {
  source: OfficeState; controls?: ReactNode; onToggleLlm?: (enabled: boolean) => Promise<void>;
  auditWall?: ReactNode | ((snapshot: OfficeSnapshot, focus: (anchor: AnchorId) => void) => ReactNode); inboxTray?: ReactNode; storyStart?: boolean; storyPreview?: (preview: StoryChapter['preview']) => void;
}) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, () => INITIAL_OFFICE);
  // First person is the only view; the floor plan below is drawn only while WebGL is lost or unavailable.
  const [viewport, dispatch] = useReducer(viewportReducer, INITIAL_VIEWPORT);
  const touch = useTouch();
  const { lostContext, sceneAttempt, touring } = viewport;
  const layers = viewportLayers(viewport);
  const [focus, setFocus] = useState<AnchorId | null>(null);
  // Room buttons, tour stops and story chapters walk the Play camera to the room (a new seq re-walks the same room).
  const [guide, setGuide] = useState<PlayGuide | null>(null);
  const focusRoom = useCallback((room: AnchorId | null) => {
    setFocus(room);
    setGuide(current => room ? { room, seq: (current?.seq ?? 0) + 1 } : null);
  }, []);
  const [inspecting, setInspecting] = useState<AnchorId | null>(null);
  const [motions] = useState(() => new MotionRegistry());
  const [playTarget, setPlayTarget] = useState<PlayTarget | null>(null);
  const [play] = useState((): PlayBridge & { hud: { current: HTMLDivElement | null }; coworkers: { current: readonly CoworkerSpot[] } } => ({ input: new PlayInput(), onTarget: setPlayTarget, hud: { current: null }, coworkers: { current: [] } }));
  const presence = usePresence({ mode: touring ? 'tour' : 'play', hud: play.hud, source, connectionMode: snapshot.connection });
  play.coworkers.current = coworkerSpots(presence.peers);
  const { setEnabled: setPresence } = presence;
  const showCoworkers = useCallback(() => setPresence(true), [setPresence]);
  const chat = useProximityChat({ active: presence.enabled, hud: play.hud, selfId: presence.selfId, presence: presence.enabled, showCoworkers });
  const textView = useRef<HTMLElement>(null);
  /** The exit from first person: every seat, receipt and the inbox as plain text below the office. */
  function showTextView() {
    if (document.pointerLockElement) document.exitPointerLock?.();
    textView.current?.focus();
  }
  // The splash supplies the user gesture pointer lock and audio need; the HUD waits behind it.
  const [splash, setSplash] = useState(false);
  const [hudStart, setHudStart] = useState({ look: false, focus: false });
  function enterPlay() { setSplash(false); saveStartView('play'); setHudStart({ look: true, focus: true }); }
  function enterText() { setSplash(false); saveStartView('overview'); showTextView(); }
  const recorded = snapshot.connection === 'replay';
  // The 3D scene renders on demand: request a frame here, not from effects inside the Canvas root.
  useEffect(() => { if (motions.sync(snapshot.agents, { recorded })) requestSceneFrame(); }, [motions, snapshot.agents, recorded]);
  const labels: RoomLabels = { lobby: useRef(null), collections: useRef(null), payables: useRef(null), vendor_onboarding: useRef(null), dana: useRef(null), treasury: useRef(null) };
  const onFailure = useCallback(() => dispatch({ type: 'lost', attempt: sceneAttempt }), [sceneAttempt]);
  const onRestored = useCallback(() => dispatch({ type: 'restored', attempt: sceneAttempt }), [sceneAttempt]);
  const tagElements = useRef(new Map<string, HTMLDivElement>());
  const agentTag = useCallback<AgentTagLookup>(id => tagElements.current.get(id), []);
  const [tour, setTour] = useState<{ stops: AnchorId[]; index: number } | null>(null);
  const rooms = visibleRooms(snapshot);
  const { storyActive, reducedMotion, chapters, closeStory, changeStoryChapter, startStory, viewportRef } = useStoryMode({
    rooms, storyStart, setFocus: focusRoom, setInspecting, setTour,
  });
  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;
  const stopTour = useCallback(() => dispatch({ type: 'endTour' }), []);
  // The tour walks the Play camera: each stop is a guided walk, and finishing leaves the viewer where it stopped.
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
      focusRoom(stops[index]!);
      timer = setTimeout(step, Math.max(0, started + (index + 1) * TOUR_STEP_MS - performance.now()));
    }
    step();
    return () => { clearTimeout(timer); setTour(null); };
  }, [touring, storyActive, focusRoom]);
  // Any input ends the tour. Added after the tour commits, so the click that started it does not cancel it.
  useEffect(() => {
    if (!touring || storyActive) return;
    for (const type of TOUR_INTERRUPT_EVENTS) window.addEventListener(type, stopTour, { capture: true, passive: true });
    return () => { for (const type of TOUR_INTERRUPT_EVENTS) window.removeEventListener(type, stopTour, { capture: true }); };
  }, [touring, stopTour, storyActive]);
  const tourStop = touring && tour ? tour.stops[tour.index] : undefined;
  useEffect(() => {
    if (storyStart || source.getSnapshot().connection === 'replay') return;
    if (startView({ search: window.location.search, stored: readStartView(), compact: window.matchMedia(COMPACT_QUERY).matches }) === 'play') setSplash(true);
  // Decided once on mount; later prop changes never reopen the splash.
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
  return <section className='office-shell' aria-label='Backroom office' data-connection={snapshot.connection}>
    {source.getSnapshot().connection !== 'replay' && <h1 className='visually-hidden'>Northfield Studio back office</h1>}
    <header className='office-toolbar'>
      <div><strong>Backroom</strong><span className='toolbar-divider'>/</span><span>Northfield Studio</span></div>
      <div className='office-tools'>
        <span className='connection-status' role='status'>{snapshot.connection === 'preview' ? 'Preview · simulated state' : snapshot.connection === 'replay' ? 'REPLAY · recorded state' : snapshot.connection === 'live' ? 'State connected' : `State ${snapshot.connection}`}</span>
        <PresenceChip enabled={presence.enabled} setEnabled={presence.setEnabled} peers={presence.peers} selfName={presence.selfName} mode={touring ? 'tour' : 'play'} />
        <fieldset disabled={!onToggleLlm || snapshot.connection !== 'live'} className='llm-control'>
          <LlmToggle llmEnabled={snapshot.llmEnabled} onToggle={onToggleLlm ?? (async () => { throw new Error('Controller transport required'); })} />
        </fieldset>
        <button type='button' onClick={() => { if (storyActive) closeStory(); else startStory(); }}>Story mode</button>
        {!touring && <button type='button' className='office-start-tour' onClick={() => dispatch({ type: 'startTour' })}>Tour</button>}
        <a className='office-text-link' href='#office-text-view' onClick={event => { event.preventDefault(); showTextView(); }}>Text view</a>
      </div>
    </header>
    <nav className='room-navigation' aria-label='Room camera presets'>
      <button aria-pressed={focus === null} onClick={() => { focusRoom(null); setInspecting(null); }}>Full floor</button>
      {visibleRooms(snapshot).map(room => <button key={room} aria-pressed={focus === room} onClick={() => { focusRoom(room); setInspecting(null); }}>{OFFICE_ANCHORS[room].name}{room === 'treasury' ? ' · Locked' : ''}</button>)}
    </nav>
    <div ref={viewportRef} className='office-viewport' data-testid='office-viewport'>
      <SoundToggle snapshot={snapshot} />
      <p className='visually-hidden'>First-person 3D office. Use the room buttons to walk to a room, or the Text view link for every seat and receipt as text.</p>
      <ViewBoundary name='3D scene' resetKey={sceneAttempt} fallback={<FloorPlan snapshot={snapshot} motions={motions} select={inspect} />} onFailure={onFailure}>
        <>
          {/* Keyed by attempt: retrying after a lost context builds a fresh Canvas and WebGL context.
              Kept mounted while lost so `webglcontextrestored` can bring this attempt back. */}
          <div key={layers.scene.key} style={{ position: 'absolute', inset: 0, visibility: layers.scene.visible ? undefined : 'hidden' }} aria-hidden={!layers.scene.visible || undefined}>
            <OfficeScene snapshot={snapshot} motions={motions} paused={!layers.scene.visible} focus={focus} guide={guide} labels={labels} agentTag={agentTag} onFailure={onFailure} onRestored={onRestored} play={play} presence={presence.peers} chatBubbles={chat.bubbles} />
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
        </>
      </ViewBoundary>
      {layers.scene.visible && !splash && <PlayHud snapshot={snapshot} input={play.input} target={playTarget} hud={play.hud} onExit={showTextView} lookOnStart={hudStart.look} focusOnStart={hudStart.focus} chat={chat} />}
      {inspecting && <RoomInspector room={inspecting} snapshot={snapshot} close={closeInspector} inboxTray={inboxTray} />}
      <div className='office-caption'>{lostContext ? '3D unavailable · floor plan active' : touring ? tour ? tourCaption(tour.index, tour.stops) : 'Tour' : touch ? PLAY_TOUCH_HINT : PLAY_HINT}</div>
      <p className='visually-hidden' role='status' aria-live='polite'>{tourStop ? `Tour stop: ${OFFICE_ANCHORS[tourStop].name}` : ''}</p>
      {touring && <button type='button' className='tour-stop' onClick={stopTour}>Stop tour</button>}
      {lostContext && <button type='button' className='tour-stop' onClick={() => dispatch({ type: 'retry' })}>Retry 3D</button>}
      {storyActive && <StoryMode key={chapters.length} chapters={chapters} onChapter={changeStoryChapter} onExit={closeStory} onPreview={storyPreview} reduced={reducedMotion} snapshot={snapshot} />}
      {snapshot.connection === 'disconnected' && <div className='office-disconnected' role='alert'>Connection lost. Last received state is shown; model control is disabled.</div>}
    </div>
    {splash && <PlaySplash onEnter={enterPlay} onText={enterText} />}
    <footer ref={textView} id='office-text-view' className='office-footer' tabIndex={-1}>
      <h2 className='visually-hidden'>Text view</h2>
      {layers.scene.visible && <button type='button' className='office-text-back' onClick={() => play.hud.current?.focus()}>Back to first person</button>}
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
      {controls}
    </footer>
  </section>;
}
/** Explicit preview producer; its controls cannot call reducers, tools or models. */
export function MockOffice({ storyStart = false }: { storyStart?: boolean }) {
  const [mock] = useState(createMockOfficeState);
  const snapshot = useSyncExternalStore(mock.source.subscribe, mock.source.getSnapshot, () => INITIAL_OFFICE);
  const atDana = snapshot.agents[0]?.targetAnchor === 'dana';
  return <Office source={mock.source} storyStart={storyStart} storyPreview={preview => { if (preview === 'denial') mock.denyTreasury(); if (preview === 'escalation') mock.setTargetAnchor('dana'); }} auditWall={(snapshot, focus) => <OfficeLobby snapshot={snapshot} focus={focus} />} controls={<div className='mock-controls'>
    <span>Preview only</span>
    <button onClick={() => mock.setTargetAnchor(atDana ? 'collections' : 'dana')}>{atDana ? 'Return to Collections' : 'Preview escalation'}</button>
    <button onClick={() => mock.denyTreasury()}>Preview Treasury denial</button>
  </div>} />;
}
