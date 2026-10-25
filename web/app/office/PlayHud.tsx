'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { isCloseKey } from '../../lib/office/a11y';
import { requestSceneFrame } from '../../lib/office/frame';
import { setBakedTalkingAgent } from '../../lib/office/baked-character';
import { playOfficeCue } from '../../lib/office/sound-events';
import { applyTurnTap, playPanel, targetKey, targetLabel, type PlayControl, type PlayInput, type PlayTarget } from '../../lib/office/play';
import {
  DEFAULT_PLAY_SETTINGS, SENSITIVITY_RANGE, SPEED_RANGE, feelFlags, formatMultiplier, lookDelta, type PlaySettings,
} from '../../lib/office/playSettings';
import type { OfficeSnapshot } from '../../lib/office/state';
import { crosshairView } from '../../lib/office/playFeel';
import { interactionLabel } from '../../lib/office/folder';
import { interactionStore } from '../../lib/office/interactions';
import { playTargetModule } from '../../lib/office/targets';
import { visibleRooms } from '../../lib/office/state';
import { InteractPrompt } from './InteractPrompt';
import { isOverviewKey, playOwnsMoveKeys } from '../../lib/office/overview';
import { useGamepad } from './useGamepad';
import { anchorsToAgent, setAnchoredCard } from './hud/diegetic/cardAnchor';
import { PlayMinimap } from './PlayMinimap';
import { PLAY_PANEL_VIEWS } from './panels';
import { useHandoffPresentation } from './handoffs/HandoffPresentation';
import { usePlaySettings } from './immersive/usePlaySettings';
import { requestPointerLock, usePointerLockChrome } from './immersive/usePointerLock';
import { useImmersiveAudio } from './immersive/useImmersiveAudio';
import { RoomEntryLabel } from './RoomEntryLabel';
import { ProximityChat } from './ProximityChat';
import type { PlayChat } from './useProximityChat';
import { agentCues, cueKeyFor } from '../../lib/office/agent-motion';
import './play.css';
import './playfeel.css';

export const PLAY_HINT = 'Click to look · WASD move · ←/→ turn · E interact · O overview · Esc exit';
export const PLAY_TOUCH_HINT = 'Drag to look · stick to move · tap Interact · Exit Play to leave';
const TOUCH_QUERY = '(pointer: coarse), (max-width: 760px)';
const CONTROLS: Record<string, PlayControl> = {
  w: 'forward', arrowup: 'forward', keyw: 'forward', s: 'back', arrowdown: 'back', keys: 'back',
  a: 'left', keya: 'left', d: 'right', keyd: 'right', arrowleft: 'turnLeft', arrowright: 'turnRight',
};
function control(event: KeyboardEvent): PlayControl | undefined {
  return CONTROLS[event.key.toLowerCase()] ?? CONTROLS[event.code.toLowerCase()];
}
function subscribeTouch(onChange: () => void) {
  const query = window.matchMedia(TOUCH_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
/** Touch or narrow screen; `false` on the server and during hydration. */
export function useTouch() {
  return useSyncExternalStore(subscribeTouch, () => window.matchMedia(TOUCH_QUERY).matches, () => false);
}
function locked(element: Element | null) {
  return !!element && document.pointerLockElement === element;
}
function releasePointer() {
  if (document.pointerLockElement) document.exitPointerLock?.();
}

/**
 * Reuses the lobby's single ask-why entry point; never renders its own or calls /api/why.
 * A question only prefills the field: the viewer still submits it there.
 */
export function focusAskWhy(question?: string) {
  // The ask-why entry lives in the office panels drawer (closed by default): open it first.
  window.dispatchEvent(new CustomEvent('office-drawer'));
  const mount = document.querySelector<HTMLElement>("[data-office-mount='ask-why']");
  if (!mount) return;
  mount.scrollIntoView({ block: 'center' });
  const input = mount.querySelector<HTMLInputElement>('input:not([type=hidden]):not([disabled])');
  if (question && input) {
    // Controlled React input: set through the native setter so its onChange sees the value.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, question);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const field = input ?? mount.querySelector<HTMLElement>('textarea:not([disabled])') ?? mount.querySelector<HTMLElement>('button:not([disabled])');
  field?.focus({ preventScroll: true });
}

function PlaySettingsDialog({ settings, change, close }: { settings: PlaySettings; change: (next: PlaySettings) => void; close: () => void }) {
  const headingId = useId();
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  return <section className='play-panel play-settings' role='dialog' aria-labelledby={headingId} onKeyDown={event => {
    if (isCloseKey(event.key)) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <header><h2 id={headingId}>Play settings</h2><button onClick={close} aria-label='Close Play settings'>Close</button></header>
    <label className='play-setting'><span>Look sensitivity <output>{formatMultiplier(settings.sensitivity)}</output></span>
      <input ref={first} aria-label='Look sensitivity' type='range' min={SENSITIVITY_RANGE.min} max={SENSITIVITY_RANGE.max} step={SENSITIVITY_RANGE.step} value={settings.sensitivity}
        onChange={event => change({ ...settings, sensitivity: Number(event.target.value) })} />
    </label>
    <label className='play-setting'><span>Movement speed <output>{formatMultiplier(settings.speed)}</output></span>
      <input aria-label='Movement speed' type='range' min={SPEED_RANGE.min} max={SPEED_RANGE.max} step={SPEED_RANGE.step} value={settings.speed}
        onChange={event => change({ ...settings, speed: Number(event.target.value) })} />
    </label>
    <label className='play-setting play-setting-check'>
      <input type='checkbox' checked={settings.invertY} onChange={event => change({ ...settings, invertY: event.target.checked })} /> Invert Y (look)
    </label>
    <fieldset className='play-setting-group'><legend>Movement feel</legend>
      <label className='play-setting play-setting-check'>
        <input type='checkbox' checked={settings.smoothMove} onChange={event => change({ ...settings, smoothMove: event.target.checked })} /> Smooth movement
      </label>
      <label className='play-setting play-setting-check'>
        <input type='checkbox' checked={settings.headBob} onChange={event => change({ ...settings, headBob: event.target.checked })} /> Head bob
      </label>
      <label className='play-setting play-setting-check'>
        <input type='checkbox' checked={settings.fovKick} onChange={event => change({ ...settings, fovKick: event.target.checked })} /> Field-of-view kick
      </label>
      <p className='play-settings-note'>All three stay off while your system asks to reduce motion.</p>
    </fieldset>
    <p className='play-settings-note'>Saved in this browser only.</p>
    <button className='play-settings-reset' onClick={() => change(DEFAULT_PLAY_SETTINGS)}>Reset to defaults</button>
  </section>;
}

export function PlayPanelDialog({ snapshot, target, close, askWhy }: { snapshot: OfficeSnapshot; target: PlayTarget; close: () => void; askWhy: (question?: string) => void }) {
  const handoffFor = useHandoffPresentation()?.handoffFor;
  const headingId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = playPanel(snapshot, target, handoffFor);
  const key = targetKey(target);
  useEffect(() => { closeButton.current?.focus(); }, [key]);
  if (!panel) return null;
  // Per-kind layout comes from the panel view registry (./panels); kinds without an entry use the defaults.
  const view = PLAY_PANEL_VIEWS[panel.kind] ?? {};
  // HUD variant (c): a seated agent's dialog is a speech card the scene pins over that agent (hud/diegetic).
  const anchored = target.kind === 'agent' && anchorsToAgent(target.kind) ? target.id : null;
  return <section className={anchored ? 'play-panel diegetic-card' : 'play-panel'} role='dialog' aria-labelledby={headingId} data-target-kind={target.kind}
    ref={anchored ? element => { setAnchoredCard(element ? { element, agentId: anchored } : null); return () => setAnchoredCard(null); } : undefined}
    onKeyDown={event => {
    if (isCloseKey(event.key)) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <header>{view.ownHeading ? <p id={headingId}><strong>{panel.title}</strong></p> : <h2 id={headingId}>{panel.title}</h2>}<button ref={closeButton} onClick={close} aria-label={`Close ${panel.title}`}>Close</button></header>
    {panel.state && <p className='play-panel-state'>{panel.state}</p>}
    {panel.task && <p>{panel.task}</p>}
    {view.Body && <view.Body panel={panel} askWhy={askWhy} />}
    {!view.hideAudit && (panel.entries.length ? <ol className='play-panel-audit' aria-label='Audit entries'>{panel.entries.map(entry => <li key={entry.id} data-audit-id={entry.id}>
      <strong className={entry.decision === 'DENY' ? 'denial-text' : ''}>{entry.decision}</strong> {entry.summary}<br />
      <span>{entry.ruleIds.join(', ') || 'no rule ids'}</span> · <code>{entry.id}</code>
    </li>)}</ol> : <p>No audit entries yet.</p>)}
    {!view.hideAskWhy && <button className='play-panel-ask' onClick={() => askWhy()}>Ask why</button>}
  </section>;
}

/**
 * First-person overlay (initial bundle, no WebGL imports). Keys are handled on the play surface;
 * the lazy scene's PlayRig reads `input` and requests frames only while something is held.
 */
export function PlayHud({ snapshot, input, target, hud, onExit, onHelp, onOverview, chat, lookOnStart = false, keyOwners = { story: false, menu: false } }: {
  snapshot: OfficeSnapshot; input: PlayInput; target: PlayTarget | null; hud: RefObject<HTMLDivElement | null>; onExit: () => void; onHelp?: () => void;
  /** Toggle to the Overview camera (O or the Overview button); absent hides the button. */
  onOverview?: () => void; chat?: PlayChat;
  /** Story mode or an Overview menu owning the arrow keys: Play then records no movement or turn input. */
  keyOwners?: { story: boolean; menu: boolean };
  /** Entered from an explicit Enter click: ask for pointer lock right away (that click is the user gesture). */
  lookOnStart?: boolean;
}) {
  const ownsMoveKeys = playOwnsMoveKeys(keyOwners);
  const ownsMoveKeysRef = useRef(ownsMoveKeys);
  ownsMoveKeysRef.current = ownsMoveKeys;
  useEffect(() => { if (!ownsMoveKeys) { input.clear(); requestSceneFrame(); } }, [ownsMoveKeys, input]);
  const touch = useTouch();
  const local = useSyncExternalStore(interactionStore.subscribe, interactionStore.getSnapshot, interactionStore.getServerSnapshot);
  const handoffFor = useHandoffPresentation()?.handoffFor;
  const [panel, setPanel] = useState<PlayTarget | null>(null);
  const [settings, changeSettings] = usePlaySettings();
  usePointerLockChrome(hud);
  useImmersiveAudio(hud, snapshot);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [chatOpen, setChatOpen] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const lookOnMount = useRef(lookOnStart);

  useEffect(() => {
    const surface = hud.current;
    surface?.focus();
    if (surface && lookOnMount.current) requestLook(surface);
    requestSceneFrame();
    return () => {
      input.clear();
      if (locked(surface)) releasePointer();
      requestSceneFrame();
    };
  }, [hud, input]);
  useEffect(() => { input.speed = settings.speed; }, [input, settings.speed]);
  useEffect(() => { input.feel = feelFlags(settings); }, [input, settings.smoothMove, settings.headBob, settings.fovKick]);
  // The agent being talked to faces the player and listens until the dialog closes (view only).
  useEffect(() => {
    agentCues.setTalking(panel ? cueKeyFor(panel) : null);
    return () => agentCues.setTalking(null);
  }, [panel]);
  useEffect(() => {
    if (panel && !playPanel(snapshot, panel, handoffFor)) { setPanel(null); hud.current?.focus(); }
  }, [panel, snapshot, hud, handoffFor]);
  // View-only signal for the baked characters' talk clip (?art=baked); a no-op for the blocky figures.
  useEffect(() => {
    setBakedTalkingAgent(panel?.kind === 'agent' ? panel.id : null);
    return () => setBakedTalkingAgent(null);
  }, [panel]);

  function interact() {
    if (panel || settingsOpen || chatOpen) return;
    const current = targetRef.current;
    if (!current && interactionStore.getSnapshot().folder === null) {
      const pose = hud.current?.dataset;
      if (pose?.playerX === undefined || pose.playerZ === undefined || pose.playerYaw === undefined) return;
      interactionStore.putDown([Number(pose.playerX), Number(pose.playerZ)], Number(pose.playerYaw), visibleRooms(snapshot));
      requestSceneFrame();
      return;
    }
    if (!current) return;
    const module = playTargetModule(current.kind);
    if (module.activate) {
      module.activate(current);
      requestSceneFrame();
      return;
    }
    setSettingsOpen(false);
    releaseStick();
    input.clear();
    releasePointer();
    requestSceneFrame();
    const cue = cueKeyFor(current);
    if (cue) agentCues.greet(cue);
    setPanel(current);
    playOfficeCue('interact');
  }
  function openSettings() {
    releaseStick();
    input.clear();
    releasePointer();
    requestSceneFrame();
    setPanel(null);
    setSettingsOpen(true);
  }
  function closeSettings() {
    setSettingsOpen(false);
    hud.current?.focus();
  }
  function openChat() {
    releaseStick();
    input.clear();
    releasePointer();
    requestSceneFrame();
    setPanel(null);
    setChatOpen(true);
  }
  function closePanel() {
    setPanel(null);
    hud.current?.focus();
  }
  function askWhy(question?: string) {
    setPanel(null);
    releasePointer();
    onExit();
    focusAskWhy(question);
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === '?') { event.preventDefault(); event.stopPropagation(); onHelp?.(); return; }
    if (isCloseKey(event.key)) {
      event.preventDefault();
      if (locked(event.currentTarget)) releasePointer();
      else onExit();
      return;
    }
    if (event.key === 'e' || event.key === 'E' || event.key === 'Enter') {
      event.preventDefault();
      if (!event.repeat) interact();
      return;
    }
    if (onOverview && isOverviewKey(event)) {
      // Stop here: Office's window listener would otherwise see the same O once Overview has rendered.
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) { releasePointer(); onOverview(); }
      return;
    }
    if (chat && (event.key === 't' || event.key === 'T')) {
      event.preventDefault();
      if (!event.repeat) openChat();
      return;
    }
    const held = control(event);
    if (!held) return;
    // Leave the key to its owner (story chapters, an Overview menu) and record nothing.
    if (!ownsMoveKeysRef.current) return;
    event.preventDefault();
    // A tap (keydown then keyup before the next frame) still has to yaw. Repeats keep turning via turnIntent.
    if (!event.repeat) applyTurnTap(input, held);
    input.press(held);
    requestSceneFrame();
  }
  function onKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    const held = control(event);
    if (!held) return;
    event.preventDefault();
    input.release(held);
    requestSceneFrame();
  }
  function requestLook(element: HTMLDivElement) {
    if (!touch) requestPointerLock(element);
  }
  function onSurfacePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!touch) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }
  function onSurfacePointerMove(event: PointerEvent<HTMLDivElement>) {
    const last = drag.current;
    if (!last || last.id !== event.pointerId) return;
    input.look(...lookDelta(event.clientX - last.x, event.clientY - last.y, settingsRef.current, 2));
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    requestSceneFrame();
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }
  function steer(event: PointerEvent<HTMLDivElement>) {
    if (panel) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const radius = rect.width / 2 || 1;
    const x = (event.clientX - rect.left - radius) / radius;
    const y = (event.clientY - rect.top - rect.height / 2) / radius;
    input.setJoystick(x, -y);
    if (knob.current) knob.current.style.transform = `translate(${input.joystick[0] * radius * 0.6}px, ${-input.joystick[1] * radius * 0.6}px)`;
    requestSceneFrame();
  }
  function releaseStick() {
    input.setJoystick(0, 0);
    if (knob.current) knob.current.style.transform = '';
    requestSceneFrame();
  }

  useGamepad({ input, enabled: true, move: !panel, onInteract: panel ? undefined : interact, onExit: panel ? closePanel : onExit });

  const { state: aim, prompt } = crosshairView(interactionLabel(target ? targetLabel(snapshot, target) : null, local.folder), !!panel || settingsOpen || chatOpen);
  return <div className='play-hud'>
    <PlayMinimap snapshot={snapshot} hud={hud} />
    <div ref={hud} className='play-surface' tabIndex={0} role='application' data-touch={touch || undefined}
      aria-label='First-person office. W A S D or arrow keys to move, left and right arrows turn, E to interact, O for the overview, Escape to exit Play.'
      onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={() => { input.clear(); requestSceneFrame(); }}
      onClick={event => requestLook(event.currentTarget)}
      onMouseMove={event => {
        if (!locked(event.currentTarget)) return;
        input.look(...lookDelta(event.movementX, event.movementY, settingsRef.current));
        requestSceneFrame();
      }}
      onPointerDown={onSurfacePointerDown} onPointerMove={onSurfacePointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
    <div className='play-crosshair' data-state={aim} data-kind={aim === 'target' ? target?.kind : undefined} aria-hidden='true' />
    <RoomEntryLabel hud={hud} snapshot={snapshot} />
    <InteractPrompt prompt={prompt} />
    {onOverview && <button className='play-overview' aria-keyshortcuts='O' onClick={() => { releasePointer(); onOverview(); }}>Overview <kbd>O</kbd></button>}
    <button className='play-exit' onClick={onExit}>Exit Play</button>
    <button className='play-settings-toggle' aria-expanded={settingsOpen} onClick={() => settingsOpen ? closeSettings() : openSettings()}>Settings</button>
    <a href='/operator' onClick={releasePointer} style={{ position: 'absolute', right: 18, top: 92, color: '#f3dfb9', background: '#30382df2', padding: '6px 10px', fontSize: 13 }}>Operator</a>
    {touch && <>
      <div className='play-joystick' aria-hidden='true' onPointerDown={event => { event.currentTarget.setPointerCapture?.(event.pointerId); steer(event); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) steer(event); }} onPointerUp={releaseStick} onPointerCancel={releaseStick} onLostPointerCapture={releaseStick}>
        <span ref={knob} />
      </div>
      {aim === 'target' && <button className='play-interact' onClick={interact}>Interact</button>}
    </>}
    {settingsOpen && <PlaySettingsDialog settings={settings} change={changeSettings} close={closeSettings} />}
    {chat && <ProximityChat chat={chat} open={chatOpen} onOpen={openChat} onClose={() => setChatOpen(false)} hud={hud} />}
    {panel && <PlayPanelDialog snapshot={snapshot} target={panel} close={closePanel} askWhy={askWhy} />}
  </div>;
}
