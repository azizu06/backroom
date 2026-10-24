'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { isCloseKey } from '../../lib/office/a11y';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A DOM node, or a stand-in with the same parent/child shape, so the inert set can be tested without a browser. */
export interface ModalTreeNode {
  parentElement: ModalTreeNode | null;
  readonly children: ArrayLike<ModalTreeNode>;
  contains(node: ModalTreeNode): boolean;
}

/**
 * Elements that should be `inert` while `modal` is open.
 * Siblings of the modal (up through the office shell), not the shell itself: an inert ancestor
 * would freeze the dialog too. A modal that lives outside the shell inerts the shell element.
 */
export function backgroundHosts<T extends { parentElement: T | null; readonly children: ArrayLike<T>; contains(node: T): boolean }>(shell: T | null, modal: T): T[] {
  if (!shell || shell === modal) return [];
  if (!shell.contains(modal)) return [shell];
  const hosts: T[] = [];
  for (let parent: T | null = modal.parentElement; parent; parent = parent.parentElement) {
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      if (!child || child === modal || child.contains(modal)) continue;
      hosts.push(child);
    }
    if (parent === shell) break;
  }
  return hosts;
}

/** Next element in a Tab cycle. An active node outside the list is pulled in at the matching end. */
export function nextTabStop<T>(stops: readonly T[], active: T | null, shift: boolean): T | undefined {
  const count = stops.length;
  if (count === 0) return undefined;
  const at = active === null ? -1 : stops.indexOf(active);
  if (at < 0) return shift ? stops[count - 1] : stops[0];
  return stops[(at + (shift ? -1 : 1) + count) % count];
}

export function tabbableElements(root: ParentNode): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el.tabIndex < 0 || el.hasAttribute('disabled') || el.closest('[inert]')) continue;
    result.push(el);
  }
  return result;
}

/**
 * Office modal behavior for a root that is mounted only while open.
 * Moves focus in, cycles Tab and Shift+Tab, sets `inert` on the rest of `.office-shell`,
 * closes on Escape from anywhere inside (or outside, if focus escaped), and restores the opener.
 * A `<dialog>` is shown with `showModal` so the rest of the document, including overlays outside
 * the shell, is inert and above other z-index layers.
 */
export function useModal<T extends HTMLElement>(onClose: () => void): RefObject<T | null> {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useLayoutEffect(() => {
    const modal = ref.current;
    if (!modal) return;
    const opener = document.activeElement instanceof HTMLElement && !modal.contains(document.activeElement) ? document.activeElement : null;
    if (modal instanceof HTMLDialogElement && !modal.open) {
      try { modal.showModal(); } catch { /* not connected, or already open; the trap below still applies */ }
    }
    const shell = modal.closest('.office-shell');
    const inerted: HTMLElement[] = [];
    for (const node of backgroundHosts<Element>(shell, modal)) {
      if (!(node instanceof HTMLElement) || node.hasAttribute('inert')) continue;
      node.setAttribute('inert', '');
      inerted.push(node);
    }
    if (!(modal instanceof HTMLDialogElement) && modal.tabIndex < 0 && !modal.hasAttribute('tabindex')) modal.tabIndex = -1;
    (tabbableElements(modal)[0] ?? modal).focus({ preventScroll: true });

    let closed = false;
    function close() {
      if (closed) return;
      closed = true;
      onCloseRef.current();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (isCloseKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
      const stops = tabbableElements(modal!);
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      event.preventDefault();
      (nextTabStop(stops, active, event.shiftKey) ?? modal!).focus({ preventScroll: true });
    }
    function onCancel(event: Event) {
      event.preventDefault();
      close();
    }
    document.addEventListener('keydown', onKeyDown, true);
    modal.addEventListener('cancel', onCancel);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      modal.removeEventListener('cancel', onCancel);
      for (const node of inerted) node.removeAttribute('inert');
      if (modal instanceof HTMLDialogElement && modal.open) {
        try { modal.close(); } catch { /* already closed while unmounting */ }
      }
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
