'use client';

import { useEffect, useRef } from 'react';
import { IDLE_PAD, applyPad, padEdges, readPad, type PadLike, type PadState } from '../../lib/office/gamepad';
import { requestSceneFrame } from '../../lib/office/frame';
import type { PlayInput } from '../../lib/office/play';

function connectedPad(): PadLike | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  let pads: ReturnType<Navigator['getGamepads']>;
  try { pads = navigator.getGamepads(); } catch { return null; }
  for (const pad of Array.from(pads ?? [])) if (pad && pad.connected !== false) return pad;
  return null;
}

/**
 * Standard-mapping gamepad for Play. Polls with requestAnimationFrame only while a pad is connected,
 * enabled and the page is visible; an idle office without a pad never runs a loop.
 * `move: false` keeps watching buttons (e.g. B closes a panel) but leaves the player still.
 */
export function useGamepad({ input, enabled, move = true, onInteract, onExit }: {
  input: PlayInput; enabled: boolean; move?: boolean; onInteract?: () => void; onExit?: () => void;
}) {
  const handlers = useRef({ onInteract, onExit, move });
  handlers.current = { onInteract, onExit, move };

  useEffect(() => {
    if (!enabled) return;
    let frame: number | null = null;
    let last = 0;
    let previous: PadState = IDLE_PAD;
    let wasActive = false;
    let disposed = false;

    function stop() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      previous = IDLE_PAD;
      if (wasActive || input.joystick[0] !== 0 || input.joystick[1] !== 0) {
        input.setJoystick(0, 0);
        requestSceneFrame();
      }
      wasActive = false;
    }
    function tick(now: number) {
      frame = null;
      if (disposed) return;
      const pad = connectedPad();
      if (!pad || document.hidden) { stop(); return; }
      const read = readPad(pad);
      const state = handlers.current.move ? read : { ...IDLE_PAD, interact: read.interact, exit: read.exit, connected: true };
      const dt = last ? Math.min(0.1, Math.max(0, (now - last) / 1000)) : 1 / 60;
      last = now;
      const edges = padEdges(previous, state);
      previous = state;
      const active = applyPad(input, state, dt);
      if (active || wasActive) requestSceneFrame();
      wasActive = active;
      frame = requestAnimationFrame(tick);
      if (edges.interact) handlers.current.onInteract?.();
      if (edges.exit) handlers.current.onExit?.();
    }
    function start() {
      if (disposed || frame !== null || document.hidden) return;
      const pad = connectedPad();
      if (!pad) return;
      // A button already held when polling starts does not count as a press.
      previous = readPad(pad);
      last = 0;
      frame = requestAnimationFrame(tick);
    }
    function onDisconnect() { if (!connectedPad()) stop(); }
    function onVisibility() { if (document.hidden) stop(); else start(); }

    window.addEventListener('gamepadconnected', start);
    window.addEventListener('gamepaddisconnected', onDisconnect);
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      disposed = true;
      window.removeEventListener('gamepadconnected', start);
      window.removeEventListener('gamepaddisconnected', onDisconnect);
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [enabled, input]);
}
