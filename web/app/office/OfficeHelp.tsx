'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { DEMO_GUIDE_STEPS, OFFICE_SHORTCUTS } from '../../lib/office/guide';
import './help.css';

export function DemoGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const headingId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (open) closeButton.current?.focus(); }, [open]);
  if (!open) return null;
  return <section className='office-help office-guide' role='dialog' aria-labelledby={headingId} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
  }}>
    <header><h2 id={headingId}>Try this</h2><button ref={closeButton} type='button' onClick={onClose}>Close</button></header>
    <ol>{DEMO_GUIDE_STEPS.map(step => <li key={step.id}><strong>{step.title}</strong><span>{step.detail}</span></li>)}</ol>
  </section>;
}

/** Keeps Tab and Shift+Tab inside a modal dialog: cycles through its focusable elements. */
function useFocusTrap(open: boolean, dialog: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      const root = dialog.current;
      if (event.key !== 'Tab' || !root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.hasAttribute('disabled'));
      event.preventDefault();
      if (!focusable.length) return;
      const index = focusable.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? 0 : event.shiftKey ? (index - 1 + focusable.length) % focusable.length : (index + 1) % focusable.length;
      focusable[next]!.focus();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, dialog]);
}

export function KeyboardShortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const headingId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useFocusTrap(open, dialog);
  useEffect(() => { if (open) closeButton.current?.focus(); }, [open]);
  if (!open) return null;
  return <div className='office-help-backdrop' onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className='office-help office-shortcuts' role='dialog' aria-modal='true' aria-labelledby={headingId} onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    }}>
      <header><h2 id={headingId}>Keyboard shortcuts</h2><button ref={closeButton} type='button' onClick={onClose}>Close</button></header>
      <dl>{OFFICE_SHORTCUTS.map((shortcut, index) => <div key={`${shortcut.mode}-${index}`}><dt>{shortcut.keys.map((key, keyIndex) => <kbd key={`${key}-${keyIndex}`}>{key}</kbd>)}</dt><dd>{shortcut.action}</dd></div>)}</dl>
    </section>
  </div>;
}

function isEditable(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}

export function OfficeHelp() {
  const [guideOpen, setGuideOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const guideOpener = useRef<HTMLButtonElement>(null);
  const shortcutRestore = useRef<HTMLElement | null>(null);
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
  function closeGuide() { setGuideOpen(false); guideOpener.current?.focus(); }
  function closeShortcuts() { setShortcutsOpen(false); shortcutRestore.current?.focus(); }
  return <>
    <button ref={guideOpener} type="button" className="office-guide-trigger" onClick={() => setGuideOpen(true)}>Demo guide</button>
    <DemoGuide open={guideOpen} onClose={closeGuide} />
    <KeyboardShortcuts open={shortcutsOpen} onClose={closeShortcuts} />
  </>;
}
