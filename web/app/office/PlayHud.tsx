'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { isCloseKey } from '../../lib/office/a11y';
import { requestSceneFrame } from '../../lib/office/frame';
import { serverRoomReadout, type Gx10Status } from '../../lib/gx10/server-room';
import { LOOK_SENSITIVITY, playPanel, targetKey, targetLabel, type PlayControl, type PlayInput, type PlayTarget } from '../../lib/office/play';
import type { OfficeSnapshot } from '../../lib/office/state';
import type { Handoff } from '../../lib/office/handoffs';
import PaymentLinkPanel from '../../components/PaymentLinkPanel';
import './play.css';

export const PLAY_HINT = 'Click to look · WASD move · ←/→ turn · E interact · Esc exit';
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

/** Reuses the lobby's single ask-why entry point; never renders its own or calls /api/why. */
function focusAskWhy() {
  const mount = document.querySelector<HTMLElement>("[data-office-mount='ask-why']");
  if (!mount) return;
  mount.scrollIntoView({ block: 'center' });
  const field = mount.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea:not([disabled])')
    ?? mount.querySelector<HTMLElement>('button:not([disabled])');
  field?.focus({ preventScroll: true });
}

/** Read-only GX10 readout: polls GET /api/gx10 only while open, like ServerRoom. */
function ServerPanel() {
  const [status, setStatus] = useState<Gx10Status | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch('/api/gx10', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)]) });
        if (!response.ok) throw new Error('Telemetry unavailable');
        const next = await response.json() as Gx10Status;
        if (!controller.signal.aborted) setStatus(next);
      } catch { if (!controller.signal.aborted) setStatus(null); }
      if (!controller.signal.aborted) timer = setTimeout(() => { void poll(); }, 2500);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  const view = serverRoomReadout(status);
  return <>
    <p className='play-panel-state'>{view.connection}</p>
    <p>Read-only · live telemetry, no controls.</p>
    <dl aria-label='GX10 telemetry'>
      <div><dt>Loaded models</dt><dd>{view.models}</dd></div>
      <div><dt>Output tokens/s</dt><dd data-testid='play-gx10-speed'>{view.speed}</dd></div>
      <div><dt>Request latency</dt><dd>{view.latency}</dd></div>
      <div><dt>Local share</dt><dd>{view.share}</dd></div>
    </dl>
    <p>{view.calls}</p>
  </>;
}

type HandoffResolver = (actor: string) => Handoff | undefined;
function PlayPanelDialog({ snapshot, target, close, askWhy, handoffFor }: { snapshot: OfficeSnapshot; target: PlayTarget; close: () => void; askWhy: () => void; handoffFor?: HandoffResolver }) {
  const headingId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = playPanel(snapshot, target, handoffFor);
  const key = targetKey(target);
  useEffect(() => { closeButton.current?.focus(); }, [key]);
  if (!panel) return null;
  return <section className='play-panel' role='dialog' aria-labelledby={headingId} onKeyDown={event => {
    if (isCloseKey(event.key)) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <header>{/* PaymentLinkPanel brings its own h2, so the kiosk title is not a second peer heading. */}
      {panel.kind === 'paylink' ? <p id={headingId}><strong>{panel.title}</strong></p> : <h2 id={headingId}>{panel.title}</h2>}<button ref={closeButton} onClick={close} aria-label={`Close ${panel.title}`}>Close</button></header>
    {panel.state && <p className='play-panel-state'>{panel.state}</p>}
    {panel.task && <p>{panel.task}</p>}
    {panel.kind === 'desk' && (panel.badge ? <>
      <p>Badge · policy version {panel.badge.policyVersion}</p>
      {panel.badge.limits.length ? <dl>{panel.badge.limits.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
        : <p>No monetary authority in this badge.</p>}
    </> : <p>No badge at this desk.</p>)}
    {panel.seated && (panel.seated.length ? <ul aria-label='Seated agents'>{panel.seated.map(agent => <li key={agent.id}><strong>{agent.name}</strong> · {agent.state}</li>)}</ul>
      : <p>No agents seated here.</p>)}
    {panel.locked && <p>{panel.locked}</p>}
    {panel.handoff && <dl className='play-panel-handoff' data-handoff-id={panel.handoff.id}>
      <div><dt>From</dt><dd>{panel.handoff.from}</dd></div><div><dt>To</dt><dd>{panel.handoff.to}</dd></div>
      {panel.handoff.item && <div><dt>Item</dt><dd>{panel.handoff.item}</dd></div>}
      <div><dt>Status</dt><dd>{panel.handoff.status}</dd></div><div><dt>Summary</dt><dd>{panel.handoff.summary}</dd></div>
    </dl>}
    {panel.kind === 'treasury' && panel.denial && <p className='denial-text' role='status' data-denial-audit={panel.denial.id}>
      <strong>{panel.denial.decision}</strong> Entry denied · rule {panel.denial.ruleIds.join(', ')} · audit <code>{panel.denial.id}</code>
    </p>}
    {panel.kind === 'paylink' && <PaymentLinkPanel />}
    {panel.kind === 'server' && <ServerPanel />}
    {panel.kind !== 'treasury' && panel.kind !== 'paylink' && panel.kind !== 'server' && (panel.entries.length ? <ol className='play-panel-audit' aria-label='Audit entries'>{panel.entries.map(entry => <li key={entry.id} data-audit-id={entry.id}>
      <strong className={entry.decision === 'DENY' || entry.decision === 'FAILED' ? 'denial-text' : ''}>{entry.decision}</strong> {entry.summary}<br />
      {panel.kind !== 'handoff' && <><span>{entry.ruleIds.join(', ') || 'no rule ids'}</span> · </>}<code>{entry.id}</code>
    </li>)}</ol> : <p>No audit entries yet.</p>)}
    {panel.kind !== 'paylink' && panel.kind !== 'server' && <button className='play-panel-ask' onClick={askWhy}>Ask why</button>}
  </section>;
}

/**
 * First-person overlay (initial bundle, no WebGL imports). Keys are handled on the play surface;
 * the lazy scene's PlayRig reads `input` and requests frames only while something is held.
 */
export function PlayHud({ snapshot, input, target, hud, onExit, handoffFor }: {
  snapshot: OfficeSnapshot; input: PlayInput; target: PlayTarget | null; hud: RefObject<HTMLDivElement | null>; onExit: () => void;
  handoffFor?: HandoffResolver;
}) {
  const touch = useTouch();
  const [panel, setPanel] = useState<PlayTarget | null>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const knob = useRef<HTMLSpanElement>(null);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const surface = hud.current;
    surface?.focus();
    requestSceneFrame();
    return () => {
      input.clear();
      if (locked(surface)) releasePointer();
      requestSceneFrame();
    };
  }, [hud, input]);
  useEffect(() => {
    if (panel && !playPanel(snapshot, panel, handoffFor)) { setPanel(null); hud.current?.focus(); }
  }, [panel, snapshot, hud, handoffFor]);

  function interact() {
    const current = targetRef.current;
    if (!current) return;
    releaseStick();
    input.clear();
    releasePointer();
    requestSceneFrame();
    setPanel(current);
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
    input.look(-(event.clientX - last.x) * LOOK_SENSITIVITY * 2, -(event.clientY - last.y) * LOOK_SENSITIVITY * 2);
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

  const prompt = target && !panel ? targetLabel(snapshot, target) : '';
  return <div className='play-hud'>
    <div ref={hud} className='play-surface' tabIndex={0} role='application' data-touch={touch || undefined}
      aria-label='First-person office. W A S D or arrow keys to move, left and right arrows turn, E to interact, Escape to exit Play.'
      onKeyDown={onKeyDown} onKeyUp={onKeyUp} onBlur={() => { input.clear(); requestSceneFrame(); }}
      onClick={event => requestLook(event.currentTarget)}
      onMouseMove={event => {
        if (!locked(event.currentTarget)) return;
        input.look(-event.movementX * LOOK_SENSITIVITY, -event.movementY * LOOK_SENSITIVITY);
        requestSceneFrame();
      }}
      onPointerDown={onSurfacePointerDown} onPointerMove={onSurfacePointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} />
    <div className='play-crosshair' aria-hidden='true' />
    <p className='play-prompt' aria-live='polite'>{prompt && `E · ${prompt}`}</p>
    <button className='play-exit' onClick={onExit}>Exit Play</button>
    {touch && <>
      <div className='play-joystick' aria-hidden='true' onPointerDown={event => { event.currentTarget.setPointerCapture?.(event.pointerId); steer(event); }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture?.(event.pointerId)) steer(event); }} onPointerUp={releaseStick} onPointerCancel={releaseStick} onLostPointerCapture={releaseStick}>
        <span ref={knob} />
      </div>
      {prompt && <button className='play-interact' onClick={interact}>Interact</button>}
    </>}
    {panel && <PlayPanelDialog snapshot={snapshot} target={panel} close={closePanel} askWhy={askWhy} handoffFor={handoffFor} />}
  </div>;
}
