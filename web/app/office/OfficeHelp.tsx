'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { OFFICE_SHORTCUTS } from '../../lib/office/guide';
import './help.css';

export function KeyboardShortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const headingId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      closeButton.current?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={dialog} className='office-help office-shortcuts' aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => {
      // showModal makes the page inert, but Tab past the last control can still leave the document.
      if (event.key !== 'Tab') return;
      const focusables = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])'));
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (!first || !last) return;
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <header><h2 id={headingId}>Keyboard Shortcuts</h2><button ref={closeButton} type='button' onClick={onClose}>Close</button></header>
      <dl>{OFFICE_SHORTCUTS.map((shortcut, index) => <div key={`${shortcut.mode}-${index}`}><dt>{shortcut.keys.map((key, keyIndex) => <kbd key={`${key}-${keyIndex}`}>{key}</kbd>)}</dt><dd>{shortcut.action}</dd></div>)}</dl>
  </dialog>;
}

function isEditable(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

/** The keyboard shortcuts dialog (? or the office-help event). The old "Try this" guide now lives in the sidebar's Help sheet. */
export function OfficeHelp() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutRestore = useRef<HTMLElement | null>(null);
  const wasShortcutsOpen = useRef(false);
  useEffect(() => {
    if (shortcutsOpen) wasShortcutsOpen.current = true;
    else if (wasShortcutsOpen.current) {
      wasShortcutsOpen.current = false;
      shortcutRestore.current?.focus();
    }
  }, [shortcutsOpen]);
  useEffect(() => {
    function openShortcuts() {
      shortcutRestore.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setShortcutsOpen(true);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== '?' || isEditable(event.target)) return;
      event.preventDefault();
      openShortcuts();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('office-help', openShortcuts);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('office-help', openShortcuts);
    };
  }, []);
  function closeShortcuts() { setShortcutsOpen(false); }
  return <>
    <KeyboardShortcuts open={shortcutsOpen} onClose={closeShortcuts} />
  </>;
}
