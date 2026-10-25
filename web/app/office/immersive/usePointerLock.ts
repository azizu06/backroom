'use client';

import { useEffect, type RefObject } from 'react';
import './immersive.css';

/**
 * Locks the pointer to the Play surface. Asks for raw (unaccelerated) movement where supported and falls
 * back to a plain lock; lock is optional (headless, sandboxed frames), keys still walk and turn.
 */
export function requestPointerLock(element: HTMLElement): void {
  if (document.pointerLockElement === element || typeof element.requestPointerLock !== 'function') return;
  const plain = () => {
    try {
      const retry = element.requestPointerLock() as unknown;
      if (retry instanceof Promise) retry.catch(() => { /* Pointer lock is optional. */ });
    } catch { /* Pointer lock is optional. */ }
  };
  try {
    const request = (element.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => unknown)({ unadjustedMovement: true });
    if (request instanceof Promise) request.catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotSupportedError') plain();
    });
  } catch { plain(); }
}

/**
 * Marks the office viewport while the pointer is locked to the Play surface, so the immersive stylesheet
 * hides everything but the crosshair, the E prompt and the disclosure pill. Esc releases the lock (the
 * browser does that) and the menu returns; a second Esc leaves Play through the existing path.
 */
export function usePointerLockChrome(hud: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const surface = hud.current;
    if (!surface) return;
    const root = surface.closest<HTMLElement>('.office-viewport') ?? surface.parentElement;
    const sync = () => {
      const locked = document.pointerLockElement === surface;
      if (locked) root?.setAttribute('data-pointer-locked', '');
      else root?.removeAttribute('data-pointer-locked');
    };
    sync();
    document.addEventListener('pointerlockchange', sync);
    return () => {
      document.removeEventListener('pointerlockchange', sync);
      root?.removeAttribute('data-pointer-locked');
    };
  }, [hud]);
}
