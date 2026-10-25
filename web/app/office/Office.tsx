'use client';

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { requestSceneFrame } from '../../lib/office/frame';
import { LlmToggle } from '../../components/LlmToggle';
import { SiteNav } from '../../components/SiteNav';
import { flushSync } from 'react-dom';
import { isCloseKey } from '../../lib/office/a11y';
import { PlayInput, type PlayBridge, type PlayTarget } from '../../lib/office/play';
import { PLAY_HINT, PLAY_TOUCH_HINT, PlayHud, PlayPanelDialog, focusAskWhy, useTouch } from './PlayHud';
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
import { ThemeToggle } from './ThemeToggle';
import { RainToggle } from './RainToggle';
import { PaymentToast } from './PaymentToast';
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
import { HandoffLog, HandoffPresentation, HandoffTags, useOfficeHandoffs } from './handoffs/HandoffPresentation';
import type { AgentTagLookup, RoomLabels } from './scene';
import '../office.css';
import './a11y.css';
import './lobby.css';
import './tags.css';
import './hud/diegetic/diegetic.css';
import { OfficeAdvanced } from './hud/diegetic/OfficeAdvanced';
import { lobbyModeLabel } from '../../lib/office/lobby-v2';
import { OverviewMenu, type OverviewMenuItem } from './hud/diegetic/OverviewMenu';
import { OverviewMap } from './hud/diegetic/OverviewMap';
import { agentEntry, isOverviewKey, roomEntry, seatedAgent, type OverviewPick } from '../../lib/office/overview';
import { SERVER_ROOM_BOX, officeColliders, type PlayEntry } from '../../lib/office/play';
import { LOBBY_PROP_BOXES, lobbyCollisionExtras } from '../../lib/office/baked-colliders';
import { bakedArtRequested } from '../../lib/office/baked-art';
import { interactionStore } from '../../lib/office/interactions';
import './office-tokens.css';

/** Screens the shared site nav leaves out, so every page is one click from the corner menu. */
const OFFICE_MORE_SCREENS = [
  { label: 'Calls', href: '/calls' }, { label: 'Policy', href: '/policy' }, { label: 'Payment link', href: '/payment-link' },
] as const;

function SceneLoading({ error }: { error?: Error | null }) {
  // next/dynamic passes load errors to this renderer; let the 3D ViewBoundary handle them.
  if (error) throw error;
  return <div role='status' style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'var(--page-bg)', color: 'var(--ink)' }}>
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
  const [play] = useState((): PlayBridge & { hud: { current: HTMLDivElement | null }; coworkers: { current: readonly CoworkerSpot[] }; entry: { current: PlayEntry | null }; last: { current: PlayEntry | null } } => ({
    input: new PlayInput(), onTarget: setPlayTarget, hud: { current: null }, coworkers: { current: [] }, entry: { current: null }, last: { current: null },
  }));
  const presence = usePresence({ mode, hud: play.hud, source, connectionMode: snapshot.connection });
  play.coworkers.current = coworkerSpots(presence.peers);
  const { setEnabled: setPresence } = presence;
  const showCoworkers = useCallback(() => setPresence(true), [setPresence]);
  const chat = useProximityChat({ active: mode === 'play' && presence.enabled, hud: play.hud, selfId: presence.selfId, presence: presence.enabled, showCoworkers });
  const prePlay = useRef<ViewMode>('walk');
  useEffect(() => { if (mode !== 'play') prePlay.current = mode; }, [mode]);
  function exitPlay() { saveStartView('overview'); setLookOnEnter(false); pickMode(prePlay.current); document.getElementById('office-view')?.focus(); }
  // First person is the default start; the splash supplies the user gesture pointer lock and audio need.
  const [splash, setSplash] = useState(false);
  const [lookOnEnter, setLookOnEnter] = useState(false);
  function enterPlay() { setLookOnEnter(true); enterFirstPerson(play.last.current); }
  function enterOverview() { setSplash(false); saveStartView('overview'); }
  function chooseView(next: ViewMode) { saveStartView(next === 'play' ? 'play' : 'overview'); setLookOnEnter(false); pickMode(next); }
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
  const plan = mode === 'plan' || lostContext;
  // Overview (HUD variant c): the overhead 3D camera (orbit or fixed) with quick actions; first person stays the main way to play.
  const overview = (mode === 'walk' || mode === 'tween') && !!layers.scene?.visible && !storyActive;
  const [menu, setMenu] = useState<{ pick: OverviewPick; at: { x: number; y: number }; opener: HTMLElement | null } | null>(null);
  const [talk, setTalk] = useState<{ id: string; opener: HTMLElement | null } | null>(null);
  const overviewToggle = useRef<HTMLButtonElement>(null);
  const mapButton = useRef<HTMLButtonElement>(null);
  // The Overview map: a large 2D board of the floor over the scene. Never open in first person.
  const [mapOpen, setMapOpen] = useState(false);
  useEffect(() => { if (!overview) { setMenu(null); setTalk(null); setMapOpen(false); } }, [overview]);
  function closeMap() { setMapOpen(false); setMenu(null); requestAnimationFrame(() => mapButton.current?.focus()); }
  function enterFirstPerson(entry: PlayEntry | null) {
    setMenu(null);
    setTalk(null);
    setMapOpen(false);
    setSplash(false);
    saveStartView('play');
    play.entry.current = entry;
    pickMode('play');
  }
  function toOverview() {
    saveStartView('overview');
    setLookOnEnter(false);
    pickMode(prePlay.current === 'tween' ? 'tween' : 'walk');
    setMapOpen(true);
  }
  function placeColliders() {
    const rooms = visibleRooms(snapshot);
    return officeColliders(rooms, lobbyCollisionExtras(bakedArtRequested(location.search), LOBBY_PROP_BOXES, [SERVER_ROOM_BOX]), interactionStore.getSnapshot().doors);
  }
  function goToAgent(id: string) {
    const agent = snapshot.agents.find(row => row.id === id);
    if (!agent) return;
    enterFirstPerson(agentEntry(snapshot, id, motions.get(agent).position, placeColliders(), visibleRooms(snapshot)));
  }
  function goToRoom(room: AnchorId) {
    enterFirstPerson(roomEntry(room, placeColliders(), snapshot.agents.map(agent => motions.get(agent).position)));
  }
  const viewportBox = useRef<HTMLDivElement | null>(null);
  function openMenu(pick: OverviewPick, opener: HTMLElement | null, client?: { x: number; y: number }) {
    const box = viewportBox.current?.getBoundingClientRect();
    const rect = opener?.getBoundingClientRect();
    const point = client ?? (rect ? { x: rect.left + rect.width / 2, y: rect.bottom } : { x: (box?.left ?? 0) + 40, y: (box?.top ?? 0) + 40 });
    setTalk(null);
    setMenu({ pick, at: { x: point.x - (box?.left ?? 0), y: point.y - (box?.top ?? 0) }, opener });
  }
  function onScenePick(pick: OverviewPick, at: { x: number; y: number }) {
    if (pick.kind === 'room') { goToRoom(pick.room); return; }
    const opener = document.querySelector<HTMLElement>(`[data-agent-tag="${CSS.escape(pick.id)}"] button`);
    openMenu(pick, opener, at);
  }
  const closeMenu = useCallback((restoreFocus: boolean) => {
    setMenu(current => { if (restoreFocus) current?.opener?.focus(); return null; });
  }, []);
  function openTalk(id: string, opener: HTMLElement | null) {
    // From the map, talk over the 3D scene: the card pins over the agent; focus returns to their tag.
    const fromMap = !!opener?.closest('.overview-map');
    setMenu(null);
    if (fromMap) setMapOpen(false);
    setTalk({ id, opener: fromMap ? document.querySelector<HTMLElement>(`[data-agent-tag="${CSS.escape(id)}"] button`) ?? mapButton.current : opener });
  }
  function closeTalk() { const opener = talk?.opener; setTalk(null); opener?.focus(); }
  function menuContent(pick: OverviewPick, opener: HTMLElement | null): { title: string; subtitle?: string; items: OverviewMenuItem[] } {
    if (pick.kind === 'agent') {
      const agent = snapshot.agents.find(row => row.id === pick.id);
      return { title: agent?.name ?? pick.id, subtitle: agent?.state, items: [
        { id: 'go', label: 'Go here', hint: 'first person, beside them', run: () => goToAgent(pick.id) },
        { id: 'talk', label: 'Talk', hint: 'open their talk panel', run: () => openTalk(pick.id, opener) },
      ] };
    }
    const seated = seatedAgent(snapshot, pick.room);
    const name = seated ? snapshot.agents.find(row => row.id === seated)?.name : undefined;
    const items: OverviewMenuItem[] = [{ id: 'go', label: pick.room === 'treasury' ? 'Go to the door' : 'Go here', hint: 'first person', run: () => goToRoom(pick.room) }];
    if (seated) items.push({ id: 'talk', label: `Talk to ${name}`, hint: 'open their talk panel', run: () => openTalk(seated, opener) });
    items.push({ id: 'details', label: 'Details', hint: 'badge and limits', run: () => { setMenu(null); setMapOpen(false); if (opener instanceof HTMLButtonElement && !opener.closest('.overview-map')) inspect(pick.room, opener); else { setInspecting(pick.room); setFocus(pick.room); } } });
    return { title: OFFICE_ANCHORS[pick.room].name, subtitle: pick.room === 'treasury' ? 'Locked · Dana only' : undefined, items };
  }
  // O toggles Overview and first person; in Play the surface handles it (PlayHud). Ignored while typing or in a dialog or menu.
  const overviewKey = useRef<(event: KeyboardEvent) => void>(() => {});
  overviewKey.current = event => {
    if (!overview || event.defaultPrevented || !isOverviewKey(event) || event.repeat) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && (target.isContentEditable || target.closest('input, textarea, select, dialog[open], [aria-modal=true], [role=dialog], [role=menu], [role=alertdialog]'))) return;
    event.preventDefault();
    enterFirstPerson(play.last.current);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => overviewKey.current(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // The page is just the 3D world: one corner menu (top left) and a drawer of office panels over the canvas, closed by default.
  const [cornerOpen, setCornerOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const cornerToggle = useRef<HTMLButtonElement>(null);
  const drawerToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (mode === 'play') { setCornerOpen(false); setDrawerOpen(false); } }, [mode]);
  // Other parts of the office (Play's "Ask why", the lobby) open the drawer before focusing something in it.
  useEffect(() => {
    const open = () => flushSync(() => setDrawerOpen(true));
    window.addEventListener('office-drawer', open);
    return () => window.removeEventListener('office-drawer', open);
  }, []);
  function closeCorner() { setCornerOpen(false); cornerToggle.current?.focus(); }
  function closeDrawer() { setDrawerOpen(false); drawerToggle.current?.focus(); }
  return <HandoffPresentation value={presentation}><section className='office-shell' aria-label='Backroom office' data-connection={snapshot.connection} data-hud={mode === 'play' && layers.scene?.visible ? 'diegetic' : undefined}>
    {source.getSnapshot().connection !== 'replay' && <h1 className='visually-hidden'>Northfield Studio back office</h1>}
    <div ref={element => { viewportRef.current = element; viewportBox.current = element; }} className='office-viewport' data-testid='office-viewport' data-overview={overview || undefined}>
      <SoundToggle snapshot={snapshot} />
      {/* One small corner menu: brand + view picker + guide + Overview toggle always; the rest behind Menu. */}
      <header className='office-toolbar office-corner' data-open={cornerOpen || undefined} onKeyDown={event => {
        if (cornerOpen && isCloseKey(event.key) && !(event.target instanceof HTMLSelectElement)) { event.preventDefault(); event.stopPropagation(); closeCorner(); }
      }}>
        <div className='office-corner-row'>
          <button ref={cornerToggle} type='button' className='office-corner-toggle' aria-expanded={cornerOpen} aria-controls='office-corner-panel' onClick={() => setCornerOpen(open => !open)}>
            <strong>Backroom</strong><span aria-hidden='true'>{cornerOpen ? '▴' : '▾'}</span><span className='visually-hidden'> menu</span>
          </button>
          {lobbyModeLabel(snapshot.connection) && <span className='office-mode-chip'>{lobbyModeLabel(snapshot.connection)}</span>}
          <label htmlFor='office-view' className='office-corner-view'><span className='visually-hidden'>View</span><select disabled={storyActive} ref={viewSelect} id='office-view' aria-label='Office view' value={mode} onChange={e => chooseView(e.target.value as ViewMode)}>
            {VIEW_OPTIONS.map(option => <option key={option.mode} value={option.mode}>{option.label}</option>)}
          </select></label>
          <OfficeHelp />
          {overview && <button ref={mapButton} type='button' className='office-map-button' aria-expanded={mapOpen} onClick={() => mapOpen ? closeMap() : setMapOpen(true)}>Overview</button>}
          {mode !== 'play' && <button ref={overviewToggle} type='button' className='overview-toggle' aria-keyshortcuts={overview ? 'O' : undefined} onClick={enterPlay}>
            Enter first person{overview && <> <kbd>O</kbd></>}
          </button>}
        </div>
        <div id='office-corner-panel' className='office-corner-panel' hidden={!cornerOpen}>
          <SiteNav placement='office' />
          <nav className='office-more-screens' aria-label='More screens'><ul>{OFFICE_MORE_SCREENS.map(({ label, href }) => <li key={href}><a href={href}>{label}</a></li>)}</ul></nav>
          <div className='office-tools'>
            <button type='button' onClick={() => { setCornerOpen(false); if (storyActive) closeStory(); else startStory(); }}>{storyActive ? 'Skip tour' : 'Take the tour'}</button>
            <button type='button' onClick={() => { setCornerOpen(false); pickMode('tour'); }}>Camera tour</button>
            <ThemeToggle className='theme-toggle office-theme-toggle' />
            <RainToggle />
            <PresenceChip enabled={presence.enabled} setEnabled={presence.setEnabled} peers={presence.peers} selfName={presence.selfName} mode={mode === 'play' ? 'play' : touring ? 'tour' : 'overview'} />
            <OfficeAdvanced replay={snapshot.connection === 'replay'}
              connection={snapshot.connection === 'preview' ? 'Walkthrough · local state, not live' : snapshot.connection === 'replay' ? 'REPLAY · recorded state' : snapshot.connection === 'live' ? 'State connected' : `State ${snapshot.connection}`}
              llm={<fieldset disabled={!onToggleLlm || snapshot.connection !== 'live'} className='llm-control'>
                <LlmToggle llmEnabled={snapshot.llmEnabled} onToggle={onToggleLlm ?? (async () => { throw new Error('Controller transport required'); })} />
              </fieldset>} />
          </div>
          <nav className='room-navigation' aria-label='Room camera presets'>
            <button aria-pressed={focus === null} onClick={() => { setFocus(null); setInspecting(null); setCornerOpen(false); }}>Full floor</button>
            {visibleRooms(snapshot).map(room => <button key={room} aria-pressed={focus === room} onClick={() => { setFocus(room); setInspecting(null); setCornerOpen(false); }}>{OFFICE_ANCHORS[room].name}{room === 'treasury' ? ' · Locked' : ''}</button>)}
          </nav>
          {/* Preview-only controls: a pick closes the menu so the scene shows the result. */}
          {controls && <div className='office-corner-controls' onClick={event => { if ((event.target as HTMLElement).closest('button')) setCornerOpen(false); }}>{controls}</div>}
        </div>
      </header>
      <button ref={drawerToggle} type='button' className='office-drawer-toggle' aria-expanded={drawerOpen} aria-controls='office-drawer' onClick={() => setDrawerOpen(open => !open)}>
        Office panels{snapshot.inboxCount ? ` · ${snapshot.inboxCount}` : ''}
      </button>
      <p className='visually-hidden'>3D office view. Use the room buttons to inspect badges and limits.</p>
      <ViewBoundary name='3D scene' resetKey={sceneAttempt} fallback={<FloorPlan snapshot={snapshot} motions={motions} select={inspect} />} onFailure={onFailure}>
        {!layers.scene ? <FloorPlan snapshot={snapshot} motions={motions} select={inspect} /> : <>
          {/* Keyed by attempt: picking a view after a lost context builds a fresh Canvas and WebGL context.
              Kept mounted while lost so `webglcontextrestored` can bring this attempt back. */}
          <div key={layers.scene.key} style={{ position: 'absolute', inset: 0, visibility: layers.scene.visible ? undefined : 'hidden' }} aria-hidden={!layers.scene.visible || undefined}>
            <OfficeScene snapshot={snapshot} motions={motions} fixed={isFixedCamera(mode)} tour={touring || storyActive} paused={!layers.scene.visible} focus={focus} labels={labels} agentTag={agentTag} onFailure={onFailure} onRestored={onRestored} play={mode === 'play' ? { ...play, story: storyChapter } : undefined} presence={presence.peers} chatBubbles={chat.bubbles} onPick={overview ? onScenePick : undefined} />
          </div>
          {/* In Overview each tag is a quick-action button (Tab through them). Elsewhere the footer seat statuses already
              announce every name and state (seatLabel), so the tags are hidden from assistive tech. */}
          {!layers.floorPlan && <div className='agent-tags' aria-hidden={overview ? undefined : 'true'}>{snapshot.agents.map(agent => <div key={agent.id} className='agent-tag' data-agent-tag={agent.id}
            ref={element => { if (!element) return; tagElements.current.set(agent.id, element); return () => { if (tagElements.current.get(agent.id) === element) tagElements.current.delete(agent.id); }; }}>
            {overview ? <button type='button' className='agent-tag-pick' aria-haspopup='menu' aria-expanded={menu?.pick.kind === 'agent' && menu.pick.id === agent.id}
              aria-label={`${agent.name}, ${agent.state}. Quick actions: go here or talk`} onClick={event => openMenu({ kind: 'agent', id: agent.id }, event.currentTarget)}>
              <strong>{agent.name}</strong><span className='agent-tag-state'>{agent.escalationId && '▱ '}{agent.state}</span>
            </button> : <><strong>{agent.name}</strong><span className='agent-tag-state'>{agent.escalationId && '▱ '}{agent.state}</span></>}
          </div>)}</div>}
          {!layers.floorPlan && <HandoffTags />}
          {layers.floorPlan ? <FloorPlan snapshot={snapshot} motions={motions} select={inspect} /> : visibleRooms(snapshot).map(room => {
            const badge = snapshot.badges.find(row => row.seatId === room);
            return <div key={room} ref={labels[room]} className='scene-label'>
              <button className='desk-label' aria-haspopup={overview ? 'menu' : undefined} aria-expanded={overview ? menu?.pick.kind === 'room' && menu.pick.room === room : undefined}
                onClick={event => overview ? openMenu({ kind: 'room', room }, event.currentTarget) : inspect(room, event.currentTarget)} aria-label={roomLabel(room, snapshot)}>
                {OFFICE_ANCHORS[room].name}<span>{badge ? `Badge · v${badge.policyVersion}` : room === 'treasury' ? 'Locked · Dana only' : room === 'lobby' ? 'Audit wall + inbox' : 'Human approval'}</span>
              </button>
            </div>;
          })}
        </>}
      </ViewBoundary>
      {mode === 'play' && layers.scene?.visible && (storyActive
        ? <div ref={play.hud} data-testid='story-camera' aria-hidden='true' />
        : <PlayHud snapshot={snapshot} input={play.input} target={playTarget} hud={play.hud} onExit={exitPlay} onOverview={toOverview} lookOnStart={lookOnEnter} chat={chat} keyOwners={{ story: storyActive, menu: !!menu }} onHelp={() => window.dispatchEvent(new CustomEvent('office-help'))} />)}
      {overview && <OverviewMap snapshot={snapshot} motions={motions} open={mapOpen} onPick={(pick, opener) => openMenu(pick, opener)} onFirstPerson={() => enterFirstPerson(play.last.current)} onClose={closeMap} />}
      {overview && menu && (() => { const content = menuContent(menu.pick, menu.opener); return <OverviewMenu key={JSON.stringify(menu.pick)} {...content} at={menu.at} close={closeMenu} />; })()}
      {overview && talk && <PlayPanelDialog snapshot={snapshot} target={{ kind: 'agent', id: talk.id }} close={closeTalk} askWhy={question => { setTalk(null); focusAskWhy(question); }} />}
      {inspecting && <RoomInspector room={inspecting} snapshot={snapshot} close={closeInspector} inboxTray={inboxTray} />}
      <div className='office-caption'>{lostContext ? '3D unavailable · floor plan active' : plan ? 'Floor plan · same subscribed state' : storyActive ? 'Judge tour · ←/→ chapters · Space pause · Esc exit' : mode === 'play' ? touch ? PLAY_TOUCH_HINT : PLAY_HINT : touring ? tour ? tourCaption(tour.index, tour.stops) : 'Tour' : mode === 'tween' ? 'Overview · click someone for quick actions · click a room to jump in' : 'Overview · drag to look · click someone for quick actions · click a room to jump in'}</div>
      <p className='visually-hidden' role='status' aria-live='polite'>{tourStop ? `Tour stop: ${OFFICE_ANCHORS[tourStop].name}` : ''}</p>
      {touring && <button type='button' className='tour-stop' onClick={stopTour}>Stop tour</button>}
      {storyActive && <StoryMode key={chapters.length} chapters={chapters} onChapter={changeStoryChapter} onExit={closeStory} onPreview={storyPreview} reduced={reducedMotion} snapshot={snapshot} />}
      {snapshot.connection === 'disconnected' && <div className='office-disconnected' role='alert'>Connection lost. Last received state is shown; model control is disabled.</div>}
      <PaymentToast snapshot={snapshot} />
      {splash && <PlaySplash onEnter={enterPlay} onOverview={enterOverview} />}
    </div>
    <footer id='office-drawer' className='office-footer office-drawer' hidden={!drawerOpen} aria-label='Office panels' onKeyDown={event => {
      const target = event.target as HTMLElement;
      if (isCloseKey(event.key) && !event.defaultPrevented && !target.closest('input, textarea, select, dialog, [role=dialog]')) { event.preventDefault(); closeDrawer(); }
    }}>
      <header className='office-drawer-head'><h2>Office panels</h2><button type='button' onClick={closeDrawer} aria-label='Close office panels'>Close</button></header>
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
      {auditWall && (snapshot.connection === 'preview' || snapshot.connection === 'replay') && <section id='office-preview-receipts' className='office-audit' aria-label='Walkthrough audit receipts'>
        <ViewBoundary name='Walkthrough receipts' resetKey={snapshot} fallback={<p role='status'>Walkthrough receipts unavailable · a received row could not be displayed.</p>}>
          <ReceiptList snapshot={snapshot} title='Office receipts' />
        </ViewBoundary>
      </section>}
      {inboxTray && <section id='office-inbox-tray' className='office-audit' aria-label='Lobby inbox tray' data-office-mount='inbox'><h2>Lobby inbox tray · {snapshot.inboxCount}</h2>
        <ViewBoundary name='Inbox tray' resetKey={snapshot} fallback={<p role='status'>Inbox unavailable · the tray could not be displayed.</p>}>{inboxTray}</ViewBoundary>
      </section>}
      <ViewBoundary name='Handoff log' resetKey={snapshot.handoffs} fallback={<p role='status'>Handoff log unavailable.</p>}><HandoffLog /></ViewBoundary>
    </footer>
  </section></HandoffPresentation>;
}
/** Explicit preview producer; its controls cannot call reducers, tools or models. */
export function MockOffice({ storyStart = false }: { storyStart?: boolean }) {
  const [mock] = useState(createMockOfficeState);
  const snapshot = useSyncExternalStore(mock.source.subscribe, mock.source.getSnapshot, () => INITIAL_OFFICE);
  const atDana = snapshot.agents[0]?.targetAnchor === 'dana';
  return <Office source={mock.source} storyStart={storyStart} storyPreview={preview => { if (preview === 'denial') mock.denyTreasury(); if (preview === 'escalation') mock.setTargetAnchor('dana'); }} auditWall={(snapshot, focus) => <OfficeLobby snapshot={snapshot} focus={focus} />} controls={<div className='mock-controls'>
    <span>Walkthrough controls</span>
    <a href='/inbox'>Judge inbox</a>
    <span>Receipts there are not synced into this static scene.</span>
    <button onClick={() => mock.setTargetAnchor(atDana ? 'collections' : 'dana')}>{atDana ? 'Return to Collections' : 'Show escalation'}</button>
    <button onClick={() => mock.denyTreasury()}>Show Treasury denial</button>
  </div>} />;
}
