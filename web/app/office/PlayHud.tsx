'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { isCloseKey } from '../../lib/office/a11y';
import { requestSceneFrame } from '../../lib/office/frame';
import { playOfficeCue } from '../../lib/office/sound-events';
import { playPanel, targetKey, targetLabel, type PlayControl, type PlayInput, type PlayTarget } from '../../lib/office/play';
import {
  DEFAULT_PLAY_SETTINGS, SENSITIVITY_RANGE, SPEED_RANGE, formatMultiplier, loadPlaySettings, lookDelta, savePlaySettings, type PlaySettings,
} from '../../lib/office/playSettings';
import type { OfficeSnapshot } from '../../lib/office/state';
import { useGamepad } from './useGamepad';
import { PlayMinimap } from './PlayMinimap';
import { PLAY_PANEL_VIEWS } from './panels';
import { RoomEntryLabel } from './RoomEntryLabel';
import './play.css';

export const PLAY_HINT = 'Click to look · WASD move · ←/→ turn · E interact · M map · Esc exit';
export const PLAY_TOUCH_HINT = 'Drag to look · stick to move · tap Interact · Overview to leave';
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

/** Reuses the lobby's single ask-why entry point; never renders its own or calls /api/why. */
function focusAskWhy() {
  const mount = document.querySelector<HTMLElement>("[data-office-mount='ask-why']");
  if (!mount) return;
  mount.scrollIntoView({ block: 'center' });
  const field = mount.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea:not([disabled])')
    ?? mount.querySelector<HTMLElement>('button:not([disabled])');
  field?.focus({ preventScroll: true });
}

/** localStorage can be missing or throw (private windows, blocked site data). */
function viewerStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
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
    <p className='play-settings-note'>Saved in this browser only.</p>
    <button className='play-settings-reset' onClick={() => change(DEFAULT_PLAY_SETTINGS)}>Reset to defaults</button>
  </section>;
}

function PlayPanelDialog({ snapshot, target, close, askWhy }: { snapshot: OfficeSnapshot; target: PlayTarget; close: () => void; askWhy: () => void }) {
  const headingId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = playPanel(snapshot, target);
  const key = targetKey(target);
  useEffect(() => { closeButton.current?.focus(); }, [key]);
  if (!panel) return null;
  // Per-kind layout comes from the panel view registry (./panels); kinds without an entry use the defaults.
  const view = PLAY_PANEL_VIEWS[panel.kind] ?? {};
  return <section className='play-panel' role='dialog' aria-labelledby={headingId} onKeyDown={event => {
    if (isCloseKey(event.key)) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <header>{view.ownHeading ? <p id={headingId}><strong>{panel.title}</strong></p> : <h2 id={headingId}>{panel.title}</h2>}<button ref={closeButton} onClick={close} aria-label={`Close ${panel.title}`}>Close</button></header>
    {panel.state && <p className='play-panel-state'>{panel.state}</p>}
    {panel.task && <p>{panel.task}</p>}
    {view.Body && <view.Body panel={panel} />}
    {!view.hideAudit && (panel.entries.length ? <ol className='play-panel-audit' aria-label='Audit entries'>{panel.entries.map(entry => <li key={entry.id} data-audit-id={entry.id}>
      <strong className={entry.decision === 'DENY' ? 'denial-text' : ''}>{entry.decision}</strong> {entry.summary}<br />
      <span>{entry.ruleIds.join(', ') || 'no rule ids'}</span> · <code>{entry.id}</code>
    </li>)}</ol> : <p>No audit entries yet.</p>)}
    {!view.hideAskWhy && <button className='play-panel-ask' onClick={askWhy}>Ask why</button>}
  </section>;
}

/**
 * First-person overlay (initial bundle, no WebGL imports). Keys are handled on the play surface;
 * the lazy scene's PlayRig reads `input` and requests frames only while something is held.
 */
export function PlayHud({ snapshot, input, target, hud, onExit, lookOnStart = false }: {
  snapshot: OfficeSnapshot; input: PlayInput; target: PlayTarget | null; hud: RefObject<HTMLDivElement | null>; onExit: () => void;
  /** Entered from an explicit Enter click: ask for pointer lock right away (that click is the user gesture). */
  lookOnStart?: boolean;
}) {
  const touch = useTouch();
  const [panel, setPanel] = useState<PlayTarget | null>(null);
  const [settings, setSettings] = useState<PlaySettings>(() => loadPlaySettings(viewerStorage()));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
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
  useEffect(() => {
    if (panel && !playPanel(snapshot, panel)) { setPanel(null); hud.current?.focus(); }
  }, [panel, snapshot, hud]);

  function interact() {
    const current = targetRef.current;
    if (!current) return;
    setSettingsOpen(false);
    releaseStick();
    input.clear();
    releasePointer();
    requestSceneFrame();
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
  function changeSettings(next: PlaySettings) {
    setSettings(next);
    savePlaySettings(viewerStorage(), next);
  }
  function closePanel() {
    setPanel(null);
    hud.current?.focus();
  }
  function askWhy() {
    setPanel(null);
    releasePointer();
    onExit();
    focusAskWhy();
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
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
    const held = control(event);
    if (!held) return;
    event.preventDefault();
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
    if (touch || locked(element) || typeof element.requestPointerLock !== 'function') return;
    try {
      const request = element.requestPointerLock() as unknown;
      if (request instanceof Promise) request.catch(() => { /* Pointer lock is optional; keys still turn. */ });
    } catch { /* Unavailable (e.g. sandboxed frame); keys still turn. */ }
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

  const prompt = target && !panel ? targetLabel(snapshot, target) : '';
  return <div className='play-hud'>
    <PlayMinimap snapshot={snapshot} hud={hud} />
    <div ref={hud} className='play-surface' tabIndex={0} role='application' data-touch={touch || undefined}
      aria-label='First-person office. W A S D or arrow keys to move, left and right arrows turn, E to interact, Escape to exit Play.'
      onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={() => { input.clear(); requestSceneFrame(); }}
      onClick={event => requestLook(event.currentTarget)}
      onMouseMove={event => {
        if (!locked(event.currentTarget)) return;
        input.look(...lookDelta(event.movementX, event.movementY, settingsRef.current));
        requestSceneFrame();
      }}
      onPointerDown={onSurfacePointerDown} onPointerMove={onSurfacePointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
    <div className='play-crosshair' aria-hidden='true' />
    <RoomEntryLabel hud={hud} snapshot={snapshot} />
    <p className='play-prompt' aria-live='polite'>{prompt && `E · ${prompt}`}</p>
    <button className='play-exit' onClick={onExit}>Overview</button>
    <button className='play-settings-toggle' aria-expanded={settingsOpen} onClick={() => settingsOpen ? closeSettings() : openSettings()}>Settings</button>
    {touch && <>
      <div className='play-joystick' aria-hidden='true' onPointerDown={event => { event.currentTarget.setPointerCapture?.(event.pointerId); steer(event); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) steer(event); }} onPointerUp={releaseStick} onPointerCancel={releaseStick} onLostPointerCapture={releaseStick}>
        <span ref={knob} />
      </div>
      {prompt && <button className='play-interact' onClick={interact}>Interact</button>}
    </>}
    {settingsOpen && <PlaySettingsDialog settings={settings} change={changeSettings} close={closeSettings} />}
    {panel && <PlayPanelDialog snapshot={snapshot} target={panel} close={closePanel} askWhy={askWhy} />}
  </div>;
}
